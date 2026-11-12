import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoProductRepository } from '../../../src/infrastructure/mongo/MongoProductRepository';
import { MongoStockMovementRepository } from '../../../src/infrastructure/mongo/MongoStockMovementRepository';
import { MongoConnection, connectMongo } from '../../../src/infrastructure/mongo/mongoConnection';
import { describeRepositoryContract } from '../../support/repositoryContract';
import { Repositories, buildTestApp, sampleProduct } from '../../support/testApp';

// Integração com um MongoDB de verdade (mongod baixado e iniciado pelo mongodb-memory-server).
// Na primeira execução o binário é baixado, o que pode levar alguns minutos.
// Para pular estes testes (máquina sem internet, por exemplo): SKIP_MONGO_TESTS=1 npm test

const skip = process.env.SKIP_MONGO_TESTS === '1';

describe.skipIf(skip)('integração com MongoDB real', () => {
  let server: MongoMemoryServer;
  let mongo: MongoConnection;
  let repositories: Repositories;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    mongo = await connectMongo(server.getUri(), 'pjbl_produtos_test');
    repositories = {
      products: new MongoProductRepository(mongo.products),
      movements: new MongoStockMovementRepository(mongo.movements, mongo.products),
    };
  });

  afterAll(async () => {
    await mongo?.close();
    await server?.stop();
  });

  async function emptyDatabase(): Promise<Repositories> {
    await mongo.products.deleteMany({});
    await mongo.movements.deleteMany({});
    return repositories;
  }

  describeRepositoryContract('MongoDB', emptyDatabase);

  describe('índices', () => {
    it('cria os índices esperados nas duas coleções (e pode rodar de novo sem erro)', async () => {
      await connectMongo(server.getUri(), 'pjbl_produtos_test').then((again) => again.close());

      const productIndexes = await mongo.products.indexes();
      const movementIndexes = await mongo.movements.indexes();

      expect(productIndexes.map((index) => index.name).sort()).toEqual([
        '_id_',
        'ix_products_category',
        'ix_products_name',
        'uq_products_sku',
      ]);
      expect(productIndexes.find((index) => index.name === 'uq_products_sku')).toMatchObject({ key: { sku: 1 }, unique: true });
      expect(movementIndexes.find((index) => index.name === 'ix_movements_product_date')).toMatchObject({
        key: { productId: 1, createdAt: -1 },
      });
      expect(movementIndexes.find((index) => index.name === 'uq_movements_event_id')).toMatchObject({
        key: { eventId: 1 },
        unique: true,
        partialFilterExpression: { eventId: { $type: 'string' } },
      });
    });
  });

  describe('API completa em cima do MongoDB', () => {
    let app: ReturnType<typeof buildTestApp>['app'];

    beforeEach(async () => {
      await emptyDatabase();
      ({ app } = buildTestApp(repositories, { database: 'mongo' }));
    });

    async function createProduct(stock: number, sku = 'CAFE-500G'): Promise<string> {
      const response = await request(app).post('/products').send({ ...sampleProduct, sku, stock });
      expect(response.status).toBe(201);
      return response.body.id;
    }

    it('CRUD ponta a ponta: cria, lista, busca, atualiza e exclui (apagando o histórico)', async () => {
      const id = await createProduct(12);

      const listed = await request(app).get('/products').query({ search: 'café', category: 'mercearia' });
      const updated = await request(app).put(`/products/${id}`).send({ name: 'Café especial', category: 'Cafés', price: 31.5 });
      const fetched = await request(app).get(`/products/${id}`);
      const history = await request(app).get(`/products/${id}/stock-movements`);
      const deleted = await request(app).delete(`/products/${id}`);

      expect(listed.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(updated.status).toBe(200);
      expect(fetched.body).toMatchObject({ id, sku: 'CAFE-500G', name: 'Café especial', price: 31.5, stock: 12, lowStock: false });
      expect(history.body.items.map((m: { reason: string; balanceAfter: number }) => [m.reason, m.balanceAfter])).toEqual([
        ['Estoque inicial', 12],
      ]);
      expect(deleted.status).toBe(204);
      expect((await request(app).get(`/products/${id}`)).status).toBe(404);
      expect(await mongo.movements.countDocuments({ productId: id })).toBe(0);
      expect((await request(app).get('/health')).body.database).toBe('mongo');
    });

    it('10 baixas concorrentes de 1 unidade com estoque 5: exatamente 5 sucessos e 5 conflitos', async () => {
      const id = await createProduct(5);

      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request(app)
            .post(`/products/${id}/stock-movements`)
            .send({ type: 'SAIDA', quantity: 1, reason: `Baixa concorrente ${i + 1}` }),
        ),
      );

      const ok = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);
      expect(ok).toHaveLength(5);
      expect(conflicts).toHaveLength(5);
      expect(conflicts.every((r) => r.body.error.code === 'INSUFFICIENT_STOCK')).toBe(true);

      // cada baixa aceita viu um saldo diferente: 4, 3, 2, 1 e 0 (nunca negativo, nunca repetido)
      expect(ok.map((r) => r.body.movement.balanceAfter).sort()).toEqual([0, 1, 2, 3, 4]);

      const product = await request(app).get(`/products/${id}`);
      expect(product.body.stock).toBe(0);

      // as baixas recusadas não deixam movimentação "fantasma" no histórico
      const history = await request(app).get(`/products/${id}/stock-movements`);
      expect(history.body.total).toBe(6);
      expect(await mongo.movements.countDocuments({ productId: id })).toBe(6);
      expect(await mongo.movements.countDocuments({ balanceAfter: null })).toBe(0);
    });

    it('reprocessar o mesmo eventId responde 200 duplicate:true e baixa o estoque uma única vez', async () => {
      const id = await createProduct(10);
      const body = { type: 'SAIDA', quantity: 3, reason: 'Pedido 42 criado', eventId: `3f0c8a52-evento:${id}` };

      const first = await request(app).post(`/products/${id}/stock-movements`).send(body);
      const second = await request(app).post(`/products/${id}/stock-movements`).send(body);
      const third = await request(app).post(`/products/${id}/stock-movements`).send(body);

      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ duplicate: false, movement: { balanceAfter: 7, eventId: body.eventId } });
      for (const retry of [second, third]) {
        expect(retry.status).toBe(200);
        expect(retry.body.duplicate).toBe(true);
        expect(retry.body.movement).toEqual(first.body.movement);
        expect(retry.body.product.stock).toBe(7);
      }
      expect(await mongo.movements.countDocuments({ eventId: body.eventId })).toBe(1);
    });

    it('o mesmo evento entregue 8 vezes ao mesmo tempo é aplicado só uma vez', async () => {
      const id = await createProduct(10);
      const body = { type: 'SAIDA', quantity: 2, eventId: `evento-simultaneo:${id}` };

      const responses = await Promise.all(
        Array.from({ length: 8 }, () => request(app).post(`/products/${id}/stock-movements`).send(body)),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
      expect(responses.filter((r) => r.body.duplicate === true)).toHaveLength(7);
      expect((await request(app).get(`/products/${id}`)).body.stock).toBe(8);
    });

    it('devolução (order.cancelled) com outro eventId repõe o estoque', async () => {
      const id = await createProduct(4);
      const url = `/products/${id}/stock-movements`;

      await request(app).post(url).send({ type: 'SAIDA', quantity: 4, reason: 'Pedido 7 criado', eventId: `criado-7:${id}` });
      const refund = await request(app)
        .post(url)
        .send({ type: 'ENTRADA', quantity: 4, reason: 'Pedido 7 cancelado (devolução)', eventId: `cancelado-7:${id}` });

      expect(refund.status).toBe(201);
      expect(refund.body.product).toMatchObject({ stock: 4, lowStock: true });
      expect(refund.body.movement).toMatchObject({ type: 'ENTRADA', balanceAfter: 4 });
    });

    it('o índice único barra dois cadastros simultâneos com o mesmo SKU', async () => {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => request(app).post('/products').send(sampleProduct)),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      expect(await mongo.products.countDocuments({})).toBe(1);
      // só o cadastro que venceu gravou o "Estoque inicial"
      expect(await mongo.movements.countDocuments({})).toBe(1);
    });
  });
});
