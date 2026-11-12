import { Product } from '../../domain/Product';
import { StockMovement, StockMovementDraft } from '../../domain/StockMovement';

export type ApplyStockMovementResult =
  /** Estoque atualizado e movimentação gravada com o saldo. */
  | { outcome: 'applied'; movement: StockMovement; product: Product }
  /** Já existia uma movimentação com o mesmo eventId: nada foi alterado. */
  | { outcome: 'duplicate'; movement: StockMovement }
  /** Saída maior que o saldo: nada foi alterado. */
  | { outcome: 'insufficient_stock'; product: Product }
  | { outcome: 'product_not_found' };

export interface StockMovementPage {
  items: StockMovement[];
  /** Total de movimentações do produto (não só as devolvidas). */
  total: number;
}

export interface StockMovementRepository {
  /**
   * Aplica a movimentação no estoque do produto de forma atômica e idempotente:
   * duas saídas concorrentes nunca deixam o saldo negativo e o mesmo eventId
   * nunca é aplicado duas vezes.
   */
  apply(draft: StockMovementDraft): Promise<ApplyStockMovementResult>;

  /** Só registra no histórico, sem mexer no saldo (usado para o estoque inicial). */
  append(movement: StockMovement): Promise<void>;

  /** Mais recentes primeiro. */
  listByProduct(productId: string, limit: number): Promise<StockMovementPage>;

  deleteByProduct(productId: string): Promise<void>;
}
