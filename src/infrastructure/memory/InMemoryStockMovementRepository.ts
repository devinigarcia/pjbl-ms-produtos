import {
  ApplyStockMovementResult,
  StockMovementPage,
  StockMovementRepository,
} from '../../application/ports/StockMovementRepository';
import { InsufficientStockError } from '../../domain/errors';
import { Product } from '../../domain/Product';
import { StockMovement, StockMovementDraft } from '../../domain/StockMovement';
import { InMemoryDatabase } from './InMemoryDatabase';

export class InMemoryStockMovementRepository implements StockMovementRepository {
  constructor(private readonly db: InMemoryDatabase = new InMemoryDatabase()) {}

  // Não há nenhum "await" no meio deste método, então no modelo de execução do Node
  // (uma thread só) ele já é atômico. No Mongo a mesma garantia vem do índice único + $inc condicional.
  async apply(draft: StockMovementDraft): Promise<ApplyStockMovementResult> {
    if (draft.eventId) {
      const existing = this.db.movements.find((m) => m.eventId === draft.eventId);
      if (existing) return { outcome: 'duplicate', movement: existing };
    }

    const props = this.db.products.get(draft.productId);
    if (!props) return { outcome: 'product_not_found' };

    const product = Product.restore(props);
    let balanceAfter: number;
    try {
      balanceAfter = product.applyMovement(draft.type, draft.quantity, draft.createdAt);
    } catch (error) {
      if (error instanceof InsufficientStockError) return { outcome: 'insufficient_stock', product };
      throw error;
    }

    const movement: StockMovement = { ...draft, balanceAfter };
    this.db.products.set(product.id, product.toProps());
    this.db.movements.push(movement);
    return { outcome: 'applied', movement, product };
  }

  async append(movement: StockMovement): Promise<void> {
    this.db.movements.push(movement);
  }

  async listByProduct(productId: string, limit: number): Promise<StockMovementPage> {
    const all = this.db.movements
      .map((movement, index) => ({ movement, index }))
      .filter(({ movement }) => movement.productId === productId)
      // mais recentes primeiro; em caso de empate no horário vale a ordem de inserção
      .sort((a, b) => b.movement.createdAt.getTime() - a.movement.createdAt.getTime() || b.index - a.index)
      .map(({ movement }) => movement);

    return { items: all.slice(0, limit), total: all.length };
  }

  async deleteByProduct(productId: string): Promise<void> {
    this.db.movements = this.db.movements.filter((movement) => movement.productId !== productId);
  }
}
