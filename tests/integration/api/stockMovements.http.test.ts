import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, sampleProduct } from '../../support/testApp';

describe('API de estoque (HTTP)', () => {
  let app: ReturnType<typeof buildTestApp>['app'];
  let productId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    const created = await request(app).post('/products').send({ ...sampleProduct, stock: 5 });
    productId = created.body.id;
  });

  const movements = () => `/products/${productId}/stock-movements`;

  it('POST registra a movimentação e responde 201 com { movement, product, duplicate: false }', async () => {
    const response = await request(app).post(movements()).send({ type: 'ENTRADA', quantity: 10, reason: 'Reposição' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      movement: {
        id: expect.any(String),
        productId,
        type: 'ENTRADA',
        quantity: 10,
        reason: 'Reposição',
        eventId: null,
        balanceAfter: 15,
        createdAt: expect.any(String),
      },
      product: expect.objectContaining({ id: productId, stock: 15, lowStock: false }),
      duplicate: false,
    });
  });

  it('POST com o mesmo eventId responde 200 duplicate:true e não baixa o estoque de novo', async () => {
    const body = { type: 'SAIDA', quantity: 2, reason: 'Pedido 42 criado', eventId: `evento-42:${productId}` };

    const first = await request(app).post(movements()).send(body);
    const second = await request(app).post(movements()).send(body);

    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.movement).toEqual(first.body.movement);
    expect(second.body.product.stock).toBe(3);

    const product = await request(app).get(`/products/${productId}`);
    expect(product.body.stock).toBe(3);
  });

  it('POST responde 409 INSUFFICIENT_STOCK com os detalhes quando falta saldo', async () => {
    const response = await request(app).post(movements()).send({ type: 'SAIDA', quantity: 6 });

    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({
      code: 'INSUFFICIENT_STOCK',
      message: 'Estoque insuficiente para "Café torrado 500g": pedido 6, disponível 5.',
      details: [{ productId, productName: 'Café torrado 500g', requested: 6, available: 5 }],
      correlationId: response.headers['x-correlation-id'],
    });
  });

  it('POST responde 404 para produto inexistente e 400 para corpo inválido', async () => {
    const missing = await request(app).post('/products/nao-existe/stock-movements').send({ type: 'ENTRADA', quantity: 1 });
    const invalid = await request(app).post(movements()).send({ type: 'entrada', quantity: -1 });

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details).toEqual([
      { field: 'type', message: 'Valor inválido. Use: ENTRADA, SAIDA.' },
      { field: 'quantity', message: 'A quantidade deve ser maior que zero.' },
    ]);
  });

  it('10 saídas simultâneas com estoque 5: cinco passam e cinco recebem 409', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post(movements()).send({ type: 'SAIDA', quantity: 1 })),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 201, 201, 409, 409, 409, 409, 409]);

    const product = await request(app).get(`/products/${productId}`);
    expect(product.body.stock).toBe(0);
  });

  it('GET devolve o histórico (mais recentes primeiro), começando pelo "Estoque inicial"', async () => {
    await request(app).post(movements()).send({ type: 'ENTRADA', quantity: 3 });
    await request(app).post(movements()).send({ type: 'SAIDA', quantity: 8, eventId: 'evento-7' });

    const all = await request(app).get(movements());
    const limited = await request(app).get(movements()).query({ limit: 1 });
    const invalid = await request(app).get(movements()).query({ limit: 201 });

    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((m: { type: string; balanceAfter: number; reason: string; eventId: string | null }) => [m.type, m.balanceAfter, m.reason, m.eventId])).toEqual([
      ['SAIDA', 0, 'Saída de estoque', 'evento-7'],
      ['ENTRADA', 8, 'Entrada de estoque', null],
      ['ENTRADA', 5, 'Estoque inicial', null],
    ]);
    expect(limited.body).toMatchObject({ total: 3 });
    expect(limited.body.items).toHaveLength(1);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details).toEqual([{ field: 'limit', message: 'O limite máximo é 200.' }]);
  });
});
