import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, sampleProduct } from '../../support/testApp';

// Testes HTTP de ponta a ponta dentro do processo: Express de verdade + repositório em memória.

describe('API de produtos (HTTP)', () => {
  let app: ReturnType<typeof buildTestApp>['app'];

  beforeEach(() => {
    ({ app } = buildTestApp());
  });

  async function createProduct(overrides: Record<string, unknown> = {}) {
    const response = await request(app).post('/products').send({ ...sampleProduct, ...overrides });
    expect(response.status).toBe(201);
    return response.body as { id: string; sku: string; stock: number; updatedAt: string };
  }

  describe('POST /products', () => {
    it('cria o produto e responde 201 com Location e o corpo no formato do contrato', async () => {
      const response = await request(app).post('/products').send(sampleProduct);

      expect(response.status).toBe(201);
      expect(response.headers.location).toBe(`/products/${response.body.id}`);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        sku: 'CAFE-500G',
        name: 'Café torrado 500g',
        description: 'Torra média',
        category: 'Mercearia',
        price: 24.9,
        stock: 12,
        lowStock: false,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    it('responde 400 VALIDATION_ERROR com os campos em details', async () => {
      const response = await request(app).post('/products').send({ sku: 'CAFE-500G', name: 'Café', category: 'Mercearia', price: 0 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos.',
          details: [{ field: 'price', message: 'Deve ser maior que zero.' }],
          correlationId: response.headers['x-correlation-id'],
        },
      });
    });

    it('responde 400 INVALID_JSON quando o corpo não é um JSON válido', async () => {
      const response = await request(app)
        .post('/products')
        .set('content-type', 'application/json')
        .send('{ "sku": "CAFE-500G", ');

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: 'INVALID_JSON' });
      expect(response.body.error.details).toBeUndefined();
    });

    it('responde 400 quando a requisição vem sem corpo', async () => {
      const response = await request(app).post('/products');

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'body' }] });
    });

    it('responde 409 SKU_ALREADY_EXISTS para SKU repetido', async () => {
      await createProduct();

      const response = await request(app).post('/products').send({ ...sampleProduct, sku: 'cafe-500g' });

      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({
        code: 'SKU_ALREADY_EXISTS',
        message: 'Já existe um produto com o SKU CAFE-500G.',
      });
    });
  });

  describe('GET /products', () => {
    it('lista com paginação, busca, categoria e ids', async () => {
      const coffee = await createProduct();
      const tea = await createProduct({ sku: 'CHA-VERDE', name: 'Chá verde', category: 'Bebidas', stock: 2 });
      await createProduct({ sku: 'SUCO-UVA', name: 'Suco de uva', category: 'Bebidas', stock: 0 });

      const all = await request(app).get('/products');
      const paged = await request(app).get('/products?page=2&pageSize=2');
      const searched = await request(app).get('/products').query({ search: 'chá' });
      const byCategory = await request(app).get('/products').query({ category: 'Bebidas' });
      const byIds = await request(app).get('/products').query({ ids: `${tea.id},${coffee.id}` });

      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
      expect(all.body.items.map((p: { sku: string }) => p.sku)).toEqual(['CAFE-500G', 'CHA-VERDE', 'SUCO-UVA']);
      expect(paged.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(paged.body.items).toHaveLength(1);
      expect(searched.body.items.map((p: { sku: string }) => p.sku)).toEqual(['CHA-VERDE']);
      expect(byCategory.body.total).toBe(2);
      expect(byIds.body.items.map((p: { id: string }) => p.id).sort()).toEqual([coffee.id, tea.id].sort());
    });

    it('responde 400 para paginação fora dos limites (pageSize máximo 100)', async () => {
      const response = await request(app).get('/products?pageSize=101&page=0');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.map((d: { field: string }) => d.field)).toEqual(['page', 'pageSize']);
    });
  });

  describe('GET /products/:id', () => {
    it('devolve o produto ou 404 PRODUCT_NOT_FOUND', async () => {
      const created = await createProduct();

      const found = await request(app).get(`/products/${created.id}`);
      const missing = await request(app).get('/products/0b6e7c1a-0000-4000-8000-000000000000');

      expect(found.status).toBe(200);
      expect(found.body).toMatchObject({ id: created.id, sku: 'CAFE-500G' });
      expect(missing.status).toBe(404);
      expect(missing.body.error).toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Produto 0b6e7c1a-0000-4000-8000-000000000000 não encontrado.',
      });
    });
  });

  describe('PUT /products/:id', () => {
    it('atualiza os dados cadastrais sem mexer no estoque', async () => {
      const created = await createProduct();

      const response = await request(app)
        .put(`/products/${created.id}`)
        .send({ name: 'Café especial', category: 'Cafés', price: 30, stock: 500 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: created.id, sku: 'CAFE-500G', name: 'Café especial', category: 'Cafés', price: 30, stock: 12 });
      expect(response.body.updatedAt > created.updatedAt).toBe(true);
    });

    it('responde 400, 404 e 409 nos casos de erro', async () => {
      const coffee = await createProduct();
      await createProduct({ sku: 'CHA-VERDE', name: 'Chá verde' });
      const valid = { name: 'Café', category: 'Mercearia', price: 10 };

      const invalid = await request(app).put(`/products/${coffee.id}`).send({ name: 'Café' });
      const missing = await request(app).put('/products/nao-existe').send(valid);
      const conflict = await request(app).put(`/products/${coffee.id}`).send({ ...valid, sku: 'CHA-VERDE' });

      expect(invalid.status).toBe(400);
      expect(invalid.body.error.details.map((d: { field: string }) => d.field)).toEqual(['category', 'price']);
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe('SKU_ALREADY_EXISTS');
    });
  });

  describe('DELETE /products/:id', () => {
    it('responde 204 sem corpo, apaga o histórico e depois o produto não existe mais', async () => {
      const created = await createProduct();

      const deleted = await request(app).delete(`/products/${created.id}`);
      const again = await request(app).delete(`/products/${created.id}`);
      const history = await request(app).get(`/products/${created.id}/stock-movements`);

      expect(deleted.status).toBe(204);
      expect(deleted.text).toBe('');
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe('PRODUCT_NOT_FOUND');
      expect(history.status).toBe(404);
    });
  });
});
