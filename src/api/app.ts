import cors from 'cors';
import express, { Express, Router } from 'express';
import helmet from 'helmet';
import { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { Handlers } from '../application/handlers';
import { mapCreateProduct } from './features/CreateProduct/CreateProductEndpoint';
import { mapDeleteProduct } from './features/DeleteProduct/DeleteProductEndpoint';
import { mapGetProduct } from './features/GetProduct/GetProductEndpoint';
import { mapListProducts } from './features/ListProducts/ListProductsEndpoint';
import { mapListStockMovements } from './features/ListStockMovements/ListStockMovementsEndpoint';
import { mapRegisterStockMovement } from './features/RegisterStockMovement/RegisterStockMovementEndpoint';
import { mapUpdateProduct } from './features/UpdateProduct/UpdateProductEndpoint';
import { apiKeyGuard } from './middlewares/apiKey';
import { correlationId, getCorrelationId } from './middlewares/correlationId';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { buildOpenApiDocument } from './openapi';

export interface AppDependencies {
  handlers: Handlers;
  logger: Logger;
  /** Só para informar no /health onde os dados estão sendo guardados. */
  database: 'mongo' | 'memory';
  internalApiKey?: string;
  /** "*" (padrão) ou origens separadas por vírgula. */
  corsOrigin?: string;
  publicUrl?: string;
}

function parseCorsOrigin(value: string | undefined): string | string[] {
  if (!value || value.trim() === '*') return '*';
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Monta a aplicação Express. Recebe tudo pronto (handlers, logger, opções) e não conhece
 * a infraestrutura: quem decide se os handlers usam Mongo ou memória é o main.ts.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // na nuvem o serviço fica atrás do ingress do Container Apps

  app.use(correlationId());
  app.use(
    pinoHttp({
      logger: deps.logger,
      customProps: (_req, res) => ({ correlationId: getCorrelationId(res as express.Response) }),
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  // CSP desligada para o Swagger UI conseguir carregar os scripts e estilos dele.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: parseCorsOrigin(deps.corsOrigin),
      exposedHeaders: ['x-correlation-id', 'location'],
    }),
  );

  // ---- rotas públicas (ficam antes da verificação da chave) ----
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ms-produtos',
      database: deps.database,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  const openApiDocument = buildOpenApiDocument({
    publicUrl: deps.publicUrl,
    apiKeyRequired: Boolean(deps.internalApiKey),
  });
  app.get('/', (_req, res) => res.redirect('/docs'));
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'ms-produtos — Conecta Store',
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  // ---- rotas de negócio ----
  app.use(apiKeyGuard(deps.internalApiKey));
  app.use(express.json({ limit: '100kb' }));

  const router = Router();
  mapCreateProduct(router, deps.handlers.createProduct);
  mapListProducts(router, deps.handlers.listProducts);
  mapGetProduct(router, deps.handlers.getProduct);
  mapUpdateProduct(router, deps.handlers.updateProduct);
  mapDeleteProduct(router, deps.handlers.deleteProduct);
  mapRegisterStockMovement(router, deps.handlers.registerStockMovement);
  mapListStockMovements(router, deps.handlers.listStockMovements);
  app.use(router);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));

  return app;
}
