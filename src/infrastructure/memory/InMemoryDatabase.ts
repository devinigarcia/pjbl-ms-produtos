import { ProductProps } from '../../domain/Product';
import { StockMovement } from '../../domain/StockMovement';

/**
 * "Banco" em memória compartilhado pelos dois repositórios. É usado nos testes e
 * quando o serviço sobe sem MONGODB_URI. Os dados somem quando o processo termina.
 */
export class InMemoryDatabase {
  readonly products = new Map<string, ProductProps>();
  /** Em ordem de inserção (a mais antiga primeiro). */
  movements: StockMovement[] = [];

  clear(): void {
    this.products.clear();
    this.movements = [];
  }
}
