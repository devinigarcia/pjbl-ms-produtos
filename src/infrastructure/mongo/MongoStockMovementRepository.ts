import { Collection, Filter } from 'mongodb';
import {
  ApplyStockMovementResult,
  StockMovementPage,
  StockMovementRepository,
} from '../../application/ports/StockMovementRepository';
import { StockMovement, StockMovementDraft, stockDelta } from '../../domain/StockMovement';
import { toProduct } from './MongoProductRepository';
import { ProductDocument, StockMovementDocument, isDuplicateKeyError } from './mongoConnection';

type SettledMovementDocument = StockMovementDocument & { balanceAfter: number };

function isSettled(doc: StockMovementDocument): doc is SettledMovementDocument {
  return typeof doc.balanceAfter === 'number';
}

function toMovement(doc: SettledMovementDocument): StockMovement {
  return {
    id: doc._id,
    productId: doc.productId,
    type: doc.type,
    quantity: doc.quantity,
    reason: doc.reason,
    eventId: doc.eventId ?? null,
    balanceAfter: doc.balanceAfter,
    createdAt: doc.createdAt,
  };
}

function toDocument(draft: StockMovementDraft, balanceAfter: number | null): StockMovementDocument {
  return {
    _id: draft.id,
    productId: draft.productId,
    type: draft.type,
    quantity: draft.quantity,
    reason: draft.reason,
    // sem eventId o campo nem é gravado, para ficar fora do índice único parcial
    ...(draft.eventId ? { eventId: draft.eventId } : {}),
    balanceAfter,
    createdAt: draft.createdAt,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface MongoStockMovementOptions {
  /** Quantas vezes conferir uma movimentação "em andamento" com o mesmo eventId antes de desistir. */
  pendingChecks?: number;
  pendingCheckIntervalMs?: number;
}

/**
 * Movimentação de estoque atômica SEM transação (o cluster gratuito do Atlas até suporta
 * transações, mas assim o código também funciona num mongod avulso). A receita é:
 *
 *  1. insere a movimentação como "pendente" (balanceAfter = null). Se o eventId já existir,
 *     o índice único recusa o insert e sabemos que é um reprocessamento;
 *  2. atualiza o estoque com um único findOneAndUpdate condicional: em saídas o filtro
 *     exige stock >= quantidade, então duas baixas concorrentes nunca deixam o saldo negativo;
 *  3. se o passo 2 não encontrou documento, desfaz o passo 1 e informa "estoque insuficiente"
 *     (ou "produto não encontrado"); se encontrou, grava o saldo na movimentação.
 */
export class MongoStockMovementRepository implements StockMovementRepository {
  private readonly pendingChecks: number;
  private readonly pendingCheckIntervalMs: number;

  constructor(
    private readonly movements: Collection<StockMovementDocument>,
    private readonly products: Collection<ProductDocument>,
    options: MongoStockMovementOptions = {},
  ) {
    this.pendingChecks = options.pendingChecks ?? 40;
    this.pendingCheckIntervalMs = options.pendingCheckIntervalMs ?? 25;
  }

  async apply(draft: StockMovementDraft): Promise<ApplyStockMovementResult> {
    // Quase sempre resolve na primeira volta. Só repete quando encontra uma movimentação
    // com o mesmo eventId que foi desfeita logo em seguida por outra requisição.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.movements.insertOne(toDocument(draft, null));
      } catch (error) {
        if (!isDuplicateKeyError(error) || !draft.eventId) throw error;

        const existing = await this.waitUntilSettled(draft.eventId);
        if (existing) return { outcome: 'duplicate', movement: toMovement(existing) };
        continue;
      }

      return this.updateStock(draft);
    }

    throw new Error(`Não foi possível registrar a movimentação do evento ${draft.eventId}: tente novamente.`);
  }

  private async updateStock(draft: StockMovementDraft): Promise<ApplyStockMovementResult> {
    const delta = stockDelta(draft.type, draft.quantity);
    const filter: Filter<ProductDocument> =
      delta < 0 ? { _id: draft.productId, stock: { $gte: draft.quantity } } : { _id: draft.productId };

    let updated: ProductDocument | null;
    try {
      updated = await this.products.findOneAndUpdate(
        filter,
        { $inc: { stock: delta }, $set: { updatedAt: draft.createdAt } },
        { returnDocument: 'after' },
      );
    } catch (error) {
      // Não sabemos se o $inc chegou a ser aplicado, mas o mais provável é que não:
      // remove a movimentação pendente para o eventId poder ser reprocessado.
      await this.movements.deleteOne({ _id: draft.id }).catch(() => undefined);
      throw error;
    }

    if (!updated) {
      await this.movements.deleteOne({ _id: draft.id });
      const current = await this.products.findOne({ _id: draft.productId });
      return current
        ? { outcome: 'insufficient_stock', product: toProduct(current) }
        : { outcome: 'product_not_found' };
    }

    await this.movements.updateOne({ _id: draft.id }, { $set: { balanceAfter: updated.stock } });

    return {
      outcome: 'applied',
      movement: { ...draft, balanceAfter: updated.stock },
      product: toProduct(updated),
    };
  }

  /**
   * Outra requisição com o mesmo eventId chegou primeiro. Espera ela terminar:
   * devolve a movimentação já com saldo, ou null se ela foi desfeita (estoque insuficiente).
   */
  private async waitUntilSettled(eventId: string): Promise<SettledMovementDocument | null> {
    for (let check = 0; check < this.pendingChecks; check++) {
      const doc = await this.movements.findOne({ eventId });
      if (!doc) return null;
      if (isSettled(doc)) return doc;
      await sleep(this.pendingCheckIntervalMs);
    }
    throw new Error(`A movimentação do evento ${eventId} ainda está em andamento: tente novamente.`);
  }

  async append(movement: StockMovement): Promise<void> {
    await this.movements.insertOne(toDocument(movement, movement.balanceAfter));
  }

  async listByProduct(productId: string, limit: number): Promise<StockMovementPage> {
    // movimentações ainda pendentes (sem saldo) não aparecem no histórico
    const query: Filter<StockMovementDocument> = { productId, balanceAfter: { $ne: null } };

    const [docs, total] = await Promise.all([
      this.movements.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray(),
      this.movements.countDocuments(query),
    ]);

    return { items: docs.filter(isSettled).map(toMovement), total };
  }

  async deleteByProduct(productId: string): Promise<void> {
    await this.movements.deleteMany({ productId });
  }
}
