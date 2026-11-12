import pino from 'pino';
import { AppDependencies, createApp } from '../../src/api/app';
import { createHandlers } from '../../src/application/handlers';
import { ProductRepository } from '../../src/application/ports/ProductRepository';
import { StockMovementRepository } from '../../src/application/ports/StockMovementRepository';
import { InMemoryDatabase } from '../../src/infrastructure/memory/InMemoryDatabase';
import { InMemoryProductRepository } from '../../src/infrastructure/memory/InMemoryProductRepository';
import { InMemoryStockMovementRepository } from '../../src/infrastructure/memory/InMemoryStockMovementRepository';

export const silentLogger = pino({ level: 'silent' });

/**
 * Relógio de mentira: cada chamada anda 1 segundo. Deixa a ordem "mais recentes primeiro"
 * previsível nos testes, mesmo quando tudo roda no mesmo milissegundo.
 */
export function tickingClock(start = '2026-01-10T12:00:00.000Z'): () => Date {
  let current = new Date(start).getTime();
  return () => {
    const now = new Date(current);
    current += 1000;
    return now;
  };
}

export interface Repositories {
  products: ProductRepository;
  movements: StockMovementRepository;
}

export function inMemoryRepositories(): Repositories & { db: InMemoryDatabase } {
  const db = new InMemoryDatabase();
  return {
    db,
    products: new InMemoryProductRepository(db),
    movements: new InMemoryStockMovementRepository(db),
  };
}

/** Handlers em cima dos repositórios em memória (testes de caso de uso). */
export function buildHandlers(repositories: Repositories = inMemoryRepositories()) {
  return createHandlers({ ...repositories, now: tickingClock() });
}

/** Aplicação Express completa, igual à de produção, só que com os repositórios escolhidos pelo teste. */
export function buildTestApp(
  repositories: Repositories = inMemoryRepositories(),
  options: Partial<Omit<AppDependencies, 'handlers'>> = {},
) {
  const handlers = createHandlers({ ...repositories, now: tickingClock() });
  const app = createApp({ handlers, logger: silentLogger, database: 'memory', ...options });
  return { app, handlers, ...repositories };
}

export const sampleProduct = {
  sku: 'CAFE-500G',
  name: 'Café torrado 500g',
  description: 'Torra média',
  category: 'Mercearia',
  price: 24.9,
  stock: 12,
};
