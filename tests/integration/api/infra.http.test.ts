import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Handlers } from '../../../src/application/handlers';
import { createApp } from '../../../src/api/app';
import { DomainError } from '../../../src/domain/errors';
import { buildTestApp, sampleProduct, silentLogger } from '../../support/testApp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('rotas de infraestrutura', () => {
  it('GET /health responde no formato do contrato', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'ms-produtos',
      database: 'memory',
      uptime: expect.any(Number),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('GET / redireciona para /docs, que serve o Swagger UI', async () => {
    const { app } = buildTestApp();

    const root = await request(app).get('/');
    const docs = await request(app).get('/docs/');

    expect(root.status).toBe(302);
    expect(root.headers.location).toBe('/docs');
    expect(docs.status).toBe(200);
    expect(docs.headers['content-type']).toMatch(/text\/html/);
    expect(docs.text).toContain('swagger-ui');
  });

  it('GET /openapi.json documenta as 7 features, o /health e a chave de acesso', async () => {
    const { app } = buildTestApp(undefined, { publicUrl: 'https://ms-produtos.exemplo.com' });

    const response = await request(app).get('/openapi.json');
    const operations = Object.entries(response.body.paths as Record<string, Record<string, { operationId: string }>>)
      .flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => `${method.toUpperCase()} ${path} ${op.operationId}`))
      .sort();

    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(response.body.servers).toEqual([{ url: 'https://ms-produtos.exemplo.com', description: 'Ambiente publicado' }]);
    expect(operations).toEqual([
      'DELETE /products/{id} deleteProduct',
      'GET /health health',
      'GET /products listProducts',
      'GET /products/{id} getProduct',
      'GET /products/{id}/stock-movements listStockMovements',
      'POST /products createProduct',
      'POST /products/{id}/stock-movements registerStockMovement',
      'PUT /products/{id} updateProduct',
    ]);
    expect(response.body.components.securitySchemes.ApiKeyAuth).toMatchObject({ type: 'apiKey', in: 'header', name: 'x-api-key' });
  });

  it('rota desconhecida responde 404 ROUTE_NOT_FOUND no formato padrão de erro', async () => {
    const { app } = buildTestApp();

    const response = await request(app).patch('/produtos/123');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Rota PATCH /produtos/123 não existe.',
        correlationId: response.headers['x-correlation-id'],
      },
    });
  });
});

describe('x-correlation-id', () => {
  it('reaproveita o valor recebido e devolve no cabeçalho e no corpo de erro', async () => {
    const { app } = buildTestApp();

    const ok = await request(app).get('/products').set('x-correlation-id', 'pedido-123.abc');
    const failed = await request(app).get('/products/nao-existe').set('x-correlation-id', 'pedido-123.abc');

    expect(ok.headers['x-correlation-id']).toBe('pedido-123.abc');
    expect(failed.headers['x-correlation-id']).toBe('pedido-123.abc');
    expect(failed.body.error.correlationId).toBe('pedido-123.abc');
  });

  it('gera um UUID quando o cabeçalho não vem ou traz um valor estranho', async () => {
    const { app } = buildTestApp();

    const absent = await request(app).get('/health');
    const weird = await request(app).get('/health').set('x-correlation-id', '<script>alert(1)</script>');

    expect(absent.headers['x-correlation-id']).toMatch(UUID);
    expect(weird.headers['x-correlation-id']).toMatch(UUID);
  });
});

describe('INTERNAL_API_KEY', () => {
  const key = 'chave-so-para-teste';

  it('quando definida, exige x-api-key nas rotas de negócio (401 UNAUTHORIZED)', async () => {
    const { app } = buildTestApp(undefined, { internalApiKey: key });

    const without = await request(app).get('/products');
    const wrong = await request(app).post('/products').set('x-api-key', 'outra-chave').send(sampleProduct);
    const right = await request(app).post('/products').set('x-api-key', key).send(sampleProduct);
    const unknownRoute = await request(app).get('/nao-existe');

    expect(without.status).toBe(401);
    expect(without.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Chave de acesso ausente ou inválida (cabeçalho x-api-key).',
        correlationId: without.headers['x-correlation-id'],
      },
    });
    expect(wrong.status).toBe(401);
    expect(right.status).toBe(201);
    expect(unknownRoute.status).toBe(401);
  });

  it('mantém /health, /docs, /openapi.json e o redirecionamento da raiz abertos', async () => {
    const { app } = buildTestApp(undefined, { internalApiKey: key });

    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/docs/')).status).toBe(200);
    expect((await request(app).get('/openapi.json')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(302);
  });

  it('sem a variável o serviço fica aberto (modo de desenvolvimento)', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/products')).status).toBe(200);
  });
});

describe('CORS', () => {
  it('libera a origem configurada e expõe x-correlation-id e location para o navegador', async () => {
    const { app } = buildTestApp(undefined, { corsOrigin: 'https://loja.exemplo.com, http://localhost:5173' });

    const response = await request(app).get('/products').set('origin', 'https://loja.exemplo.com');
    const preflight = await request(app)
      .options('/products')
      .set('origin', 'http://localhost:5173')
      .set('access-control-request-method', 'POST');
    const other = await request(app).get('/products').set('origin', 'https://outro-site.com');

    expect(response.headers['access-control-allow-origin']).toBe('https://loja.exemplo.com');
    expect(response.headers['access-control-expose-headers']).toBe('x-correlation-id,location');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('tratamento de erros', () => {
  function appWithFailingList(error: unknown) {
    const { handlers } = buildTestApp();
    const failing: Handlers = {
      ...handlers,
      listProducts: { execute: async () => Promise.reject(error) } as unknown as Handlers['listProducts'],
    };
    return createApp({ handlers: failing, logger: silentLogger, database: 'memory' });
  }

  it('erro inesperado vira 500 INTERNAL_ERROR sem vazar detalhes internos', async () => {
    const app = appWithFailingList(new Error('connection string mongodb://usuario:senha@host caiu'));

    const response = await request(app).get('/products');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno. Tente novamente em instantes.',
        correlationId: response.headers['x-correlation-id'],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('senha');
  });

  it('erro de regra de negócio (DomainError) vira 422 com o código específico', async () => {
    const app = appWithFailingList(new DomainError('REGRA_QUALQUER', 'Regra de negócio violada.'));

    const response = await request(app).get('/products');

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: 'REGRA_QUALQUER', message: 'Regra de negócio violada.' });
  });
});
