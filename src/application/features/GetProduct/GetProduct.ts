import { ProductNotFoundError } from '../../../domain/errors';
import { ProductDto, toProductDto } from '../../dtos';
import { ProductRepository } from '../../ports/ProductRepository';

export interface GetProductDeps {
  products: ProductRepository;
}

export class GetProductHandler {
  constructor(private readonly deps: GetProductDeps) {}

  async execute(productId: string): Promise<ProductDto> {
    const product = await this.deps.products.findById(productId);
    if (!product) throw new ProductNotFoundError(productId);
    return toProductDto(product);
  }
}
