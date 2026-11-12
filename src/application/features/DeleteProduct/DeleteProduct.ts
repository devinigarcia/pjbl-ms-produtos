import { ProductNotFoundError } from '../../../domain/errors';
import { ProductRepository } from '../../ports/ProductRepository';
import { StockMovementRepository } from '../../ports/StockMovementRepository';

export interface DeleteProductDeps {
  products: ProductRepository;
  movements: StockMovementRepository;
}

export class DeleteProductHandler {
  constructor(private readonly deps: DeleteProductDeps) {}

  async execute(productId: string): Promise<void> {
    const deleted = await this.deps.products.delete(productId);
    if (!deleted) throw new ProductNotFoundError(productId);

    // O histórico não faz sentido sem o produto, então vai embora junto.
    await this.deps.movements.deleteByProduct(productId);
  }
}
