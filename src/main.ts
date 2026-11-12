import { createApp } from './api/app';
import { createHandlers } from './application/handlers';
import { ProductRepository } from './application/ports/ProductRepository';
import { StockMovementRepository } from './application/ports/StockMovementRepository';
import { loadConfig, loadEnvFileIfPresent } from './infrastructure/config';
import { createLogger } from './infrastructure/logger';
import { InMemoryDatabase } from './infrastructure/memory/InMemoryDatabase';
import { InMemoryProductRepository } from './infrastructure/memory/InMemoryProductRepository';
import { InMemoryStockMovementRepository } from './infrastructure/memory/InMemoryStockMovementRepository';
import { MongoProductRepository } from './infrastructure/mongo/MongoProductRepository';
import { MongoStockMovementRepository } from './infrastructure/mongo/MongoStockMovementRepository';
import { connectMongo } from './infrastructure/mongo/mongoConnection';

// Composition root: é o único arquivo que conhece ao mesmo tempo a infraestrutura e a API.
// Aqui escolhemos as implementações das portas e entregamos tudo pronto para o Express.

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  let products: ProductRepository;
  let movements: StockMovementRepository;
  let closeDatabase: () => Promise<void> = async () => undefined;

  if (config.dbDriver === 'mongo') {
    const mongo = await connectMongo(config.mongodbUri!, config.mongodbDb);
    products = new MongoProductRepository(mongo.products);
    movements = new MongoStockMovementRepository(mongo.movements, mongo.products);
    closeDatabase = () => mongo.close();
    logger.info({ database: config.mongodbDb }, 'Conectado ao MongoDB');
  } else {
    const memory = new InMemoryDatabase();
    products = new InMemoryProductRepository(memory);
    movements = new InMemoryStockMovementRepository(memory);
    logger.warn('Usando repositório em memória: os dados somem quando o serviço for encerrado');
  }

  const app = createApp({
    handlers: createHandlers({ products, movements }),
    logger,
    database: config.dbDriver,
    internalApiKey: config.internalApiKey,
    corsOrigin: config.corsOrigin,
    publicUrl: config.publicUrl,
  });

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, database: config.dbDriver, apiKey: config.internalApiKey ? 'exigida' : 'desligada' },
      `ms-produtos no ar: http://localhost:${config.port}/docs`,
    );
  });

  // Encerramento educado: para de aceitar conexões, fecha o banco e só então sai.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Encerrando o serviço');

    server.close(() => {
      closeDatabase()
        .catch((error) => logger.error({ err: error }, 'Erro ao fechar a conexão com o banco'))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  // O logger pode nem ter sido criado ainda (erro de configuração), por isso console.error.
  console.error('Falha ao iniciar o ms-produtos:', error instanceof Error ? error.message : error);
  process.exit(1);
});
