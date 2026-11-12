import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Product } from '../../../domain/Product';
import { createInitialStockMovement } from '../../../domain/StockMovement';
import { ProductDto, toProductDto } from '../../dtos';
import { ProductRepository } from '../../ports/ProductRepository';
import { StockMovementRepository } from '../../ports/StockMovementRepository';
import { categoryField, descriptionField, initialStockField, nameField, priceField, skuField } from '../../productFields';
import { validate } from '../../validation';

export const createProductSchema = z.object(
  {
    sku: skuField,
    name: nameField,
    description: descriptionField.nullish(),
    category: categoryField,
    price: priceField,
    stock: initialStockField.nullish(),
  },
  { required_error: 'Envie os dados do produto em JSON.', invalid_type_error: 'O corpo deve ser um objeto JSON.' },
);

export type CreateProductInput = z.input<typeof createProductSchema>;

export interface CreateProductDeps {
  products: ProductRepository;
  movements: StockMovementRepository;
  now?: () => Date;
}

export class CreateProductHandler {
  private readonly now: () => Date;

  constructor(private readonly deps: CreateProductDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(input: unknown): Promise<ProductDto> {
    const data = validate(createProductSchema, input);
    const now = this.now();

    const product = Product.create({
      id: randomUUID(),
      sku: data.sku,
      name: data.name,
      description: data.description ?? '',
      category: data.category,
      price: data.price,
      stock: data.stock ?? 0,
      now,
    });

    // O índice único do SKU é quem garante a unicidade (o repositório lança SkuAlreadyExistsError).
    await this.deps.products.insert(product);

    // O estoque inicial também entra no histórico, senão o saldo não "fecha" com as movimentações.
    if (product.stock > 0) {
      await this.deps.movements.append(
        createInitialStockMovement({ id: randomUUID(), productId: product.id, quantity: product.stock, now }),
      );
    }

    return toProductDto(product);
  }
}
