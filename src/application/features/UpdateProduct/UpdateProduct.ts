import { z } from 'zod';
import { ProductNotFoundError } from '../../../domain/errors';
import { ProductDto, toProductDto } from '../../dtos';
import { ProductRepository } from '../../ports/ProductRepository';
import { categoryField, descriptionField, nameField, priceField, skuField } from '../../productFields';
import { validate } from '../../validation';

// Sem "stock" de propósito: se vier no corpo é ignorado, estoque só muda por movimentação.
export const updateProductSchema = z.object(
  {
    sku: skuField.optional(),
    name: nameField,
    description: descriptionField.nullish(),
    category: categoryField,
    price: priceField,
  },
  { required_error: 'Envie os dados do produto em JSON.', invalid_type_error: 'O corpo deve ser um objeto JSON.' },
);

export type UpdateProductInput = z.input<typeof updateProductSchema>;

export interface UpdateProductDeps {
  products: ProductRepository;
  now?: () => Date;
}

export class UpdateProductHandler {
  private readonly now: () => Date;

  constructor(private readonly deps: UpdateProductDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(productId: string, input: unknown): Promise<ProductDto> {
    const data = validate(updateProductSchema, input);

    const product = await this.deps.products.findById(productId);
    if (!product) throw new ProductNotFoundError(productId);

    product.update(
      {
        sku: data.sku,
        name: data.name,
        description: data.description ?? undefined,
        category: data.category,
        price: data.price,
      },
      this.now(),
    );

    // O repositório grava só os dados cadastrais e devolve o produto como ficou no banco,
    // assim uma movimentação de estoque que aconteça no meio do caminho não é sobrescrita.
    const saved = await this.deps.products.updateDetails(product);
    if (!saved) throw new ProductNotFoundError(productId);

    return toProductDto(saved);
  }
}
