import { Collection, Db, MongoClient, MongoServerError } from 'mongodb';
import { StockMovementType } from '../../domain/StockMovement';

// Formato dos documentos nas coleções. O id do domínio (UUID em texto) é usado direto como _id.

export interface ProductDocument {
  _id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementDocument {
  _id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  /** Só existe quando a movimentação veio de um evento (o índice único parcial depende disso). */
  eventId?: string;
  /** null enquanto a movimentação ainda está sendo aplicada no estoque. */
  balanceAfter: number | null;
  createdAt: Date;
}

export interface MongoCollections {
  products: Collection<ProductDocument>;
  movements: Collection<StockMovementDocument>;
}

export interface MongoConnection extends MongoCollections {
  client: MongoClient;
  db: Db;
  close(): Promise<void>;
}

export async function connectMongo(uri: string, dbName: string): Promise<MongoConnection> {
  const client = new MongoClient(uri, {
    appName: 'pjbl-ms-produtos',
    serverSelectionTimeoutMS: 15_000,
  });
  await client.connect();

  const db = client.db(dbName);
  const collections = getCollections(db);
  await ensureIndexes(collections);

  return { client, db, ...collections, close: () => client.close() };
}

export function getCollections(db: Db): MongoCollections {
  return {
    products: db.collection<ProductDocument>('products'),
    movements: db.collection<StockMovementDocument>('stock_movements'),
  };
}

/** Cria os índices se ainda não existirem (createIndex é idempotente). */
export async function ensureIndexes({ products, movements }: MongoCollections): Promise<void> {
  await products.createIndexes([
    { key: { sku: 1 }, name: 'uq_products_sku', unique: true },
    { key: { category: 1 }, name: 'ix_products_category' },
    { key: { name: 1 }, name: 'ix_products_name' },
  ]);

  await movements.createIndexes([
    { key: { productId: 1, createdAt: -1 }, name: 'ix_movements_product_date' },
    {
      // Idempotência: o mesmo eventId só entra uma vez. O índice é parcial para que as
      // movimentações manuais (sem eventId) não esbarrem umas nas outras.
      key: { eventId: 1 },
      name: 'uq_movements_event_id',
      unique: true,
      partialFilterExpression: { eventId: { $type: 'string' } },
    },
  ]);
}

/** Erro 11000 = violação de índice único. */
export function isDuplicateKeyError(error: unknown): error is MongoServerError {
  return error instanceof MongoServerError && error.code === 11000;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
