import { z } from 'zod';
import { ProductNotFoundError } from '../../../domain/errors';
import { StockMovementDto, toStockMovementDto } from '../../dtos';
import { ProductRepository } from '../../ports/ProductRepository';
import { StockMovementRepository } from '../../ports/StockMovementRepository';
import { validate } from '../../validation';

export const LIST_STOCK_MOVEMENTS_LIMITS = { defaultLimit: 50, maxLimit: 200 } as const;

export const listStockMovementsSchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: 'O limite deve ser um número inteiro.' })
    .int('O limite deve ser um número inteiro.')
    .min(1, 'O limite deve ser no mínimo 1.')
    .max(LIST_STOCK_MOVEMENTS_LIMITS.maxLimit, `O limite máximo é ${LIST_STOCK_MOVEMENTS_LIMITS.maxLimit}.`)
    .default(LIST_STOCK_MOVEMENTS_LIMITS.defaultLimit),
});

export type ListStockMovementsQuery = z.input<typeof listStockMovementsSchema>;

export interface ListStockMovementsResult {
  items: StockMovementDto[];
  total: number;
}

export interface ListStockMovementsDeps {
  products: ProductRepository;
  movements: StockMovementRepository;
}

export class ListStockMovementsHandler {
  constructor(private readonly deps: ListStockMovementsDeps) {}

  async execute(productId: string, query: unknown = {}): Promise<ListStockMovementsResult> {
    const { limit } = validate(listStockMovementsSchema, query ?? {});

    const product = await this.deps.products.findById(productId);
    if (!product) throw new ProductNotFoundError(productId);

    const { items, total } = await this.deps.movements.listByProduct(productId, limit);
    return { items: items.map(toStockMovementDto), total };
  }
}
