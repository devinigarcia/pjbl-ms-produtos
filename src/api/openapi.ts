import { LOW_STOCK_THRESHOLD, PRODUCT_LIMITS } from '../domain/Product';
import { STOCK_MOVEMENT_LIMITS } from '../domain/StockMovement';

// Documento OpenAPI 3 do serviço, servido em /openapi.json e renderizado pelo Swagger UI em /docs.
// É escrito à mão (em vez de gerado) para podermos caprichar nas descrições e nos exemplos.

export interface OpenApiOptions {
  /** URL pública do serviço na nuvem. Sem ela o Swagger usa o próprio endereço de onde foi aberto. */
  publicUrl?: string;
  /** true quando INTERNAL_API_KEY está configurada. */
  apiKeyRequired?: boolean;
}

const exampleProduct = {
  id: '3f2b1c9e-8a47-4d0b-9f65-2c1e7a9b4d10',
  sku: 'CAFE-500G',
  name: 'Café torrado 500g',
  description: 'Café torrado e moído, torra média.',
  category: 'Mercearia',
  price: 24.9,
  stock: 12,
  lowStock: false,
  createdAt: '2026-11-10T13:45:12.000Z',
  updatedAt: '2026-11-10T13:45:12.000Z',
};

const exampleMovementIn = {
  id: '9a1d6c3e-52b7-4f0a-8e21-7b3c5d9e1f42',
  productId: exampleProduct.id,
  type: 'ENTRADA',
  quantity: 10,
  reason: 'Reposição do fornecedor',
  eventId: null,
  balanceAfter: 22,
  createdAt: '2026-11-10T14:02:30.000Z',
};

const exampleEventId = `b7e4a2d1-6c3f-4e85-9a10-5d2f8c7b3e64:${exampleProduct.id}`;

const exampleMovementOut = {
  id: 'c4e8f1a2-7d39-4b6c-a5e0-1f2d3c4b5a69',
  productId: exampleProduct.id,
  type: 'SAIDA',
  quantity: 2,
  reason: 'Pedido 5c0d9e7f-1a2b-4c3d-8e4f-6a7b8c9d0e1f criado',
  eventId: exampleEventId,
  balanceAfter: 10,
  createdAt: '2026-11-10T14:10:05.000Z',
};

const correlationExample = '0d6f4c1e-2b3a-4f5e-9c8d-7a6b5c4d3e2f';

function errorExample(code: string, message: string, details?: unknown[]) {
  return { error: { code, message, ...(details ? { details } : {}), correlationId: correlationExample } };
}

const jsonError = (description: string, example: unknown) => ({
  description,
  headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example } },
});

const productIdParam = { $ref: '#/components/parameters/ProductId' };
const correlationParam = { $ref: '#/components/parameters/CorrelationIdHeader' };

const commonErrors = {
  '401': { $ref: '#/components/responses/Unauthorized' },
  '500': { $ref: '#/components/responses/InternalError' },
};

export function buildOpenApiDocument(options: OpenApiOptions = {}): Record<string, unknown> {
  const security = [{ ApiKeyAuth: [] }];

  return {
    openapi: '3.0.3',
    info: {
      title: 'ms-produtos — Conecta Store',
      version: '1.0.0',
      description: [
        'Microserviço de **Produtos e Estoque** da Conecta Store (projeto PJBL de Arquitetura).',
        '',
        'Guarda o catálogo no **MongoDB** e controla o estoque por **movimentações**: o saldo de um produto ' +
          'nunca é editado diretamente, ele só muda quando uma ENTRADA ou SAIDA é registrada. ' +
          'Assim o histórico sempre fecha com o saldo.',
        '',
        'No fluxo da solução este serviço fica atrás do BFF: ' +
          '`Microfrontend → API Gateway → BFF → ms-produtos`. Ele também é chamado pela Azure Function ' +
          'que consome os eventos de pedido (`order.created` baixa o estoque, `order.cancelled` devolve).',
        '',
        '**Convenções**',
        '- JSON em camelCase, datas em ISO 8601 (UTC) e dinheiro como número com 2 casas.',
        '- Toda resposta traz o cabeçalho `x-correlation-id` (o que veio na requisição ou um UUID novo).',
        '- Erros seguem sempre o formato `{ "error": { "code", "message", "details?", "correlationId" } }`.',
        '- Quando a variável `INTERNAL_API_KEY` está definida, as rotas de negócio exigem o cabeçalho ' +
          '`x-api-key`. `/health`, `/docs` e `/openapi.json` ficam sempre abertos.' +
          (options.apiKeyRequired
            ? ' **Neste ambiente a chave está ativa**: use o botão *Authorize* antes de testar.'
            : ''),
      ].join('\n'),
    },
    servers: options.publicUrl
      ? [{ url: options.publicUrl, description: 'Ambiente publicado' }]
      : [{ url: '/', description: 'Este servidor' }],
    tags: [
      { name: 'Produtos', description: 'Cadastro (CRUD) de produtos.' },
      { name: 'Estoque', description: 'Entradas, saídas e histórico de movimentações.' },
      { name: 'Infra', description: 'Verificação de saúde do serviço.' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Infra'],
          operationId: 'health',
          summary: 'Saúde do serviço',
          description: 'Usado pelo healthcheck do contêiner e pelo BFF. Não exige chave.',
          security: [],
          responses: {
            '200': {
              description: 'Serviço no ar.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Health' },
                  example: {
                    status: 'ok',
                    service: 'ms-produtos',
                    database: 'mongo',
                    uptime: 1532,
                    timestamp: '2026-11-10T14:30:00.000Z',
                  },
                },
              },
            },
          },
        },
      },

      '/products': {
        post: {
          tags: ['Produtos'],
          operationId: 'createProduct',
          summary: 'Cadastra um produto',
          description:
            'Cria o produto e, se `stock` for maior que zero, registra uma movimentação de ENTRADA ' +
            'com o motivo "Estoque inicial". O SKU é convertido para maiúsculas e precisa ser único.',
          security,
          parameters: [correlationParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateProductRequest' },
                examples: {
                  completo: {
                    summary: 'Produto com estoque inicial',
                    value: {
                      sku: 'CAFE-500G',
                      name: 'Café torrado 500g',
                      description: 'Café torrado e moído, torra média.',
                      category: 'Mercearia',
                      price: 24.9,
                      stock: 12,
                    },
                  },
                  minimo: {
                    summary: 'Só os campos obrigatórios (estoque começa em 0)',
                    value: { sku: 'FILTRO-103', name: 'Filtro de papel 103', category: 'Mercearia', price: 6.5 },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Produto criado.',
              headers: {
                Location: { description: 'Caminho do produto criado.', schema: { type: 'string', example: `/products/${exampleProduct.id}` } },
                'x-correlation-id': { $ref: '#/components/headers/CorrelationId' },
              },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' }, example: exampleProduct } },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '409': jsonError(
              'Já existe um produto com esse SKU.',
              errorExample('SKU_ALREADY_EXISTS', 'Já existe um produto com o SKU CAFE-500G.', [{ field: 'sku', value: 'CAFE-500G' }]),
            ),
            ...commonErrors,
          },
        },
        get: {
          tags: ['Produtos'],
          operationId: 'listProducts',
          summary: 'Lista produtos (com busca, filtro e paginação)',
          description:
            'Devolve os produtos em ordem alfabética de nome. Os filtros podem ser combinados; ' +
            'parâmetros vazios são ignorados.',
          security,
          parameters: [
            correlationParam,
            {
              name: 'search',
              in: 'query',
              description: 'Trecho do nome ou do SKU (não diferencia maiúsculas de minúsculas).',
              schema: { type: 'string', maxLength: 120 },
              example: 'café',
            },
            {
              name: 'category',
              in: 'query',
              description: 'Categoria exata (não diferencia maiúsculas de minúsculas).',
              schema: { type: 'string', maxLength: 120 },
              example: 'Mercearia',
            },
            {
              name: 'ids',
              in: 'query',
              description:
                'Lista de ids separados por vírgula (máx. 100). O BFF usa este filtro para buscar de uma vez ' +
                'os produtos de um pedido. Ids que não existem são simplesmente ignorados.',
              schema: { type: 'string' },
              example: `${exampleProduct.id},7e1c2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f`,
            },
            {
              name: 'page',
              in: 'query',
              description: 'Número da página, começando em 1.',
              schema: { type: 'integer', minimum: 1, default: 1 },
            },
            {
              name: 'pageSize',
              in: 'query',
              description: 'Quantidade de itens por página.',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          ],
          responses: {
            '200': {
              description: 'Página de produtos.',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ProductPage' },
                  example: { items: [exampleProduct], total: 1, page: 1, pageSize: 20 },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            ...commonErrors,
          },
        },
      },

      '/products/{id}': {
        get: {
          tags: ['Produtos'],
          operationId: 'getProduct',
          summary: 'Busca um produto pelo id',
          security,
          parameters: [productIdParam, correlationParam],
          responses: {
            '200': {
              description: 'Produto encontrado.',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' }, example: exampleProduct } },
            },
            '404': { $ref: '#/components/responses/ProductNotFound' },
            ...commonErrors,
          },
        },
        put: {
          tags: ['Produtos'],
          operationId: 'updateProduct',
          summary: 'Atualiza os dados cadastrais de um produto',
          description:
            'Altera nome, descrição, categoria, preço e (opcionalmente) o SKU. **Não mexe no estoque**: ' +
            'se o corpo trouxer `stock` ele é ignorado. Para mudar o saldo registre uma movimentação. ' +
            'Se `sku` ou `description` não forem enviados, os valores atuais são mantidos.',
          security,
          parameters: [productIdParam, correlationParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateProductRequest' },
                example: {
                  name: 'Café torrado e moído 500g',
                  description: 'Torra média, embalagem a vácuo.',
                  category: 'Mercearia',
                  price: 26.5,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Produto atualizado.',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Product' },
                  example: {
                    ...exampleProduct,
                    name: 'Café torrado e moído 500g',
                    description: 'Torra média, embalagem a vácuo.',
                    price: 26.5,
                    updatedAt: '2026-11-10T15:20:00.000Z',
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/ProductNotFound' },
            '409': jsonError(
              'O novo SKU já pertence a outro produto.',
              errorExample('SKU_ALREADY_EXISTS', 'Já existe um produto com o SKU CAFE-500G.', [{ field: 'sku', value: 'CAFE-500G' }]),
            ),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Produtos'],
          operationId: 'deleteProduct',
          summary: 'Exclui um produto',
          description: 'Remove o produto e todo o seu histórico de movimentações.',
          security,
          parameters: [productIdParam, correlationParam],
          responses: {
            '204': {
              description: 'Produto excluído (sem corpo).',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
            },
            '404': { $ref: '#/components/responses/ProductNotFound' },
            ...commonErrors,
          },
        },
      },

      '/products/{id}/stock-movements': {
        post: {
          tags: ['Estoque'],
          operationId: 'registerStockMovement',
          summary: 'Registra uma entrada ou saída de estoque',
          description: [
            'Única forma de alterar o saldo de um produto.',
            '',
            '- **Atômica**: a saída só acontece se houver saldo suficiente no instante da gravação ' +
              '(atualização condicional no MongoDB). Com 10 baixas simultâneas de 1 unidade e estoque 5, ' +
              'exatamente 5 são aceitas e 5 recebem `409 INSUFFICIENT_STOCK`.',
            '- **Idempotente**: se `eventId` for informado e já tiver sido aplicado, nada é alterado e a ' +
              'resposta é `200` com `duplicate: true` e a movimentação original. A Azure Function manda ' +
              '`"<eventId do evento>:<productId>"`, então reprocessar a mesma mensagem da fila não baixa o estoque duas vezes.',
            '- Sem `reason` o motivo fica "Entrada de estoque" ou "Saída de estoque".',
          ].join('\n'),
          security,
          parameters: [productIdParam, correlationParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegisterStockMovementRequest' },
                examples: {
                  entradaManual: {
                    summary: 'Entrada manual (reposição)',
                    value: { type: 'ENTRADA', quantity: 10, reason: 'Reposição do fornecedor' },
                  },
                  saidaPorEvento: {
                    summary: 'Saída gerada pelo evento order.created (enviada pela Azure Function)',
                    value: {
                      type: 'SAIDA',
                      quantity: 2,
                      reason: 'Pedido 5c0d9e7f-1a2b-4c3d-8e4f-6a7b8c9d0e1f criado',
                      eventId: exampleEventId,
                    },
                  },
                  devolucaoPorEvento: {
                    summary: 'Entrada gerada pelo evento order.cancelled (devolução)',
                    value: {
                      type: 'ENTRADA',
                      quantity: 2,
                      reason: 'Pedido 5c0d9e7f-1a2b-4c3d-8e4f-6a7b8c9d0e1f cancelado (devolução)',
                      eventId: `e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b:${exampleProduct.id}`,
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Movimentação aplicada agora.',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StockMovementResult' },
                  example: {
                    movement: exampleMovementOut,
                    product: { ...exampleProduct, stock: 10, updatedAt: exampleMovementOut.createdAt },
                    duplicate: false,
                  },
                },
              },
            },
            '200': {
              description: 'O `eventId` já tinha sido aplicado: nada mudou (reprocessamento).',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StockMovementResult' },
                  example: {
                    movement: exampleMovementOut,
                    product: { ...exampleProduct, stock: 10, updatedAt: exampleMovementOut.createdAt },
                    duplicate: true,
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/ProductNotFound' },
            '409': {
              description:
                'Conflito: saldo insuficiente para a saída (`INSUFFICIENT_STOCK`) ou `eventId` já usado ' +
                'na movimentação de outro produto (`EVENT_ID_ALREADY_USED`).',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                  examples: {
                    estoqueInsuficiente: {
                      summary: 'Saída maior que o saldo',
                      value: errorExample(
                        'INSUFFICIENT_STOCK',
                        'Estoque insuficiente para "Café torrado 500g": pedido 20, disponível 12.',
                        [{ productId: exampleProduct.id, productName: 'Café torrado 500g', requested: 20, available: 12 }],
                      ),
                    },
                    eventIdDeOutroProduto: {
                      summary: 'eventId já usado em outro produto',
                      value: errorExample(
                        'EVENT_ID_ALREADY_USED',
                        `O eventId ${exampleEventId} já foi usado em uma movimentação de outro produto.`,
                      ),
                    },
                  },
                },
              },
            },
            ...commonErrors,
          },
        },
        get: {
          tags: ['Estoque'],
          operationId: 'listStockMovements',
          summary: 'Histórico de movimentações de um produto',
          description: 'Mais recentes primeiro. `total` é a quantidade de movimentações do produto, não só as devolvidas.',
          security,
          parameters: [
            productIdParam,
            correlationParam,
            {
              name: 'limit',
              in: 'query',
              description: 'Quantas movimentações devolver.',
              schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            },
          ],
          responses: {
            '200': {
              description: 'Movimentações do produto.',
              headers: { 'x-correlation-id': { $ref: '#/components/headers/CorrelationId' } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StockMovementList' },
                  example: {
                    items: [
                      exampleMovementOut,
                      exampleMovementIn,
                      {
                        id: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
                        productId: exampleProduct.id,
                        type: 'ENTRADA',
                        quantity: 12,
                        reason: 'Estoque inicial',
                        eventId: null,
                        balanceAfter: 12,
                        createdAt: exampleProduct.createdAt,
                      },
                    ],
                    total: 3,
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/ProductNotFound' },
            ...commonErrors,
          },
        },
      },
    },

    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description:
            'Chave interna compartilhada com o BFF e a Azure Function. Só é exigida quando o serviço ' +
            'sobe com a variável `INTERNAL_API_KEY` definida.',
        },
      },
      parameters: {
        ProductId: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Identificador do produto (UUID).',
          schema: { type: 'string' },
          example: exampleProduct.id,
        },
        CorrelationIdHeader: {
          name: 'x-correlation-id',
          in: 'header',
          required: false,
          description: 'Identificador para rastrear a requisição entre os serviços. Se não vier, o serviço gera um.',
          schema: { type: 'string', maxLength: 128 },
        },
      },
      headers: {
        CorrelationId: {
          description: 'Mesmo identificador recebido na requisição, ou um UUID gerado pelo serviço.',
          schema: { type: 'string', example: correlationExample },
        },
      },
      responses: {
        ValidationError: jsonError(
          'Corpo ou parâmetros inválidos (`VALIDATION_ERROR`, com a lista de campos em `details`) ' +
            'ou JSON malformado (`INVALID_JSON`).',
          errorExample('VALIDATION_ERROR', 'Dados inválidos.', [{ field: 'price', message: 'Deve ser maior que zero.' }]),
        ),
        Unauthorized: jsonError(
          'Cabeçalho `x-api-key` ausente ou incorreto (só quando `INTERNAL_API_KEY` está definida).',
          errorExample('UNAUTHORIZED', 'Chave de acesso ausente ou inválida (cabeçalho x-api-key).'),
        ),
        ProductNotFound: jsonError(
          'Produto não encontrado.',
          errorExample('PRODUCT_NOT_FOUND', `Produto ${exampleProduct.id} não encontrado.`),
        ),
        InternalError: jsonError(
          'Erro inesperado.',
          errorExample('INTERNAL_ERROR', 'Erro interno. Tente novamente em instantes.'),
        ),
      },
      schemas: {
        Product: {
          type: 'object',
          required: ['id', 'sku', 'name', 'description', 'category', 'price', 'stock', 'lowStock', 'createdAt', 'updatedAt'],
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Gerado pelo serviço.' },
            sku: { type: 'string', description: 'Código único do produto, sempre em maiúsculas.', example: 'CAFE-500G' },
            name: { type: 'string', example: 'Café torrado 500g' },
            description: { type: 'string', description: 'Pode vir vazia.', example: 'Café torrado e moído, torra média.' },
            category: { type: 'string', example: 'Mercearia' },
            price: { type: 'number', format: 'double', description: 'Preço unitário em reais, com 2 casas.', example: 24.9 },
            stock: { type: 'integer', minimum: 0, description: 'Saldo atual. Só muda por movimentação.', example: 12 },
            lowStock: {
              type: 'boolean',
              description: `true quando o saldo é menor ou igual a ${LOW_STOCK_THRESHOLD}.`,
              example: false,
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateProductRequest: {
          type: 'object',
          required: ['sku', 'name', 'category', 'price'],
          properties: {
            sku: {
              type: 'string',
              pattern: '^[A-Za-z0-9][A-Za-z0-9-]{2,29}$',
              description: 'De 3 a 30 caracteres: letras, números e hífen. Minúsculas são convertidas para maiúsculas.',
              example: 'CAFE-500G',
            },
            name: { type: 'string', minLength: PRODUCT_LIMITS.nameMin, maxLength: PRODUCT_LIMITS.nameMax, example: 'Café torrado 500g' },
            description: { type: 'string', maxLength: PRODUCT_LIMITS.descriptionMax, default: '', example: 'Café torrado e moído, torra média.' },
            category: { type: 'string', minLength: PRODUCT_LIMITS.categoryMin, maxLength: PRODUCT_LIMITS.categoryMax, example: 'Mercearia' },
            price: {
              type: 'number',
              format: 'double',
              exclusiveMinimum: true,
              minimum: 0,
              maximum: PRODUCT_LIMITS.priceMax,
              description: 'Maior que zero. Valores com mais de 2 casas são arredondados.',
              example: 24.9,
            },
            stock: {
              type: 'integer',
              minimum: 0,
              maximum: PRODUCT_LIMITS.stockMax,
              default: 0,
              description: 'Estoque inicial. Vira uma movimentação de ENTRADA "Estoque inicial".',
              example: 12,
            },
          },
        },
        UpdateProductRequest: {
          type: 'object',
          required: ['name', 'category', 'price'],
          properties: {
            sku: {
              type: 'string',
              pattern: '^[A-Za-z0-9][A-Za-z0-9-]{2,29}$',
              description: 'Opcional. Se não vier, o SKU atual é mantido.',
              example: 'CAFE-500G',
            },
            name: { type: 'string', minLength: PRODUCT_LIMITS.nameMin, maxLength: PRODUCT_LIMITS.nameMax },
            description: { type: 'string', maxLength: PRODUCT_LIMITS.descriptionMax, description: 'Opcional. Se não vier, a descrição atual é mantida.' },
            category: { type: 'string', minLength: PRODUCT_LIMITS.categoryMin, maxLength: PRODUCT_LIMITS.categoryMax },
            price: { type: 'number', format: 'double', exclusiveMinimum: true, minimum: 0, maximum: PRODUCT_LIMITS.priceMax },
          },
        },
        ProductPage: {
          type: 'object',
          required: ['items', 'total', 'page', 'pageSize'],
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
            total: { type: 'integer', description: 'Total de produtos que atendem ao filtro (todas as páginas).' },
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
          },
        },
        StockMovement: {
          type: 'object',
          required: ['id', 'productId', 'type', 'quantity', 'reason', 'eventId', 'balanceAfter', 'createdAt'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            productId: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['ENTRADA', 'SAIDA'] },
            quantity: { type: 'integer', minimum: 1 },
            reason: { type: 'string', example: 'Estoque inicial' },
            eventId: {
              type: 'string',
              nullable: true,
              description: 'Chave de idempotência do evento que gerou a movimentação. `null` nas movimentações manuais.',
            },
            balanceAfter: { type: 'integer', minimum: 0, description: 'Saldo do produto logo depois desta movimentação.' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        RegisterStockMovementRequest: {
          type: 'object',
          required: ['type', 'quantity'],
          properties: {
            type: { type: 'string', enum: ['ENTRADA', 'SAIDA'], description: 'ENTRADA soma ao saldo, SAIDA subtrai.' },
            quantity: { type: 'integer', minimum: 1, maximum: STOCK_MOVEMENT_LIMITS.quantityMax, example: 10 },
            reason: { type: 'string', maxLength: STOCK_MOVEMENT_LIMITS.reasonMax, example: 'Reposição do fornecedor' },
            eventId: {
              type: 'string',
              maxLength: STOCK_MOVEMENT_LIMITS.eventIdMax,
              description: 'Opcional. Chave de idempotência: o mesmo valor nunca é aplicado duas vezes.',
              example: exampleEventId,
            },
          },
        },
        StockMovementResult: {
          type: 'object',
          required: ['movement', 'product', 'duplicate'],
          properties: {
            movement: { $ref: '#/components/schemas/StockMovement' },
            product: { $ref: '#/components/schemas/Product' },
            duplicate: {
              type: 'boolean',
              description: 'false = aplicada agora (HTTP 201). true = o eventId já tinha sido aplicado (HTTP 200).',
            },
          },
        },
        StockMovementList: {
          type: 'object',
          required: ['items', 'total'],
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/StockMovement' } },
            total: { type: 'integer' },
          },
        },
        Health: {
          type: 'object',
          required: ['status', 'service', 'database', 'uptime', 'timestamp'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            service: { type: 'string', enum: ['ms-produtos'] },
            database: { type: 'string', enum: ['mongo', 'memory'], description: 'Onde os dados estão sendo guardados.' },
            uptime: { type: 'number', description: 'Segundos desde que o processo subiu.' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'correlationId'],
              properties: {
                code: {
                  type: 'string',
                  description: 'Código fixo, em inglês, para o cliente tratar o erro.',
                  enum: [
                    'VALIDATION_ERROR',
                    'INVALID_JSON',
                    'UNAUTHORIZED',
                    'PRODUCT_NOT_FOUND',
                    'ROUTE_NOT_FOUND',
                    'SKU_ALREADY_EXISTS',
                    'INSUFFICIENT_STOCK',
                    'EVENT_ID_ALREADY_USED',
                    'PAYLOAD_TOO_LARGE',
                    'INTERNAL_ERROR',
                  ],
                },
                message: { type: 'string', description: 'Mensagem em português para exibir ou registrar.' },
                details: {
                  type: 'array',
                  description: 'Presente em alguns erros. Em VALIDATION_ERROR é uma lista de `{ field, message }`.',
                  items: { type: 'object', additionalProperties: true },
                },
                correlationId: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}
