import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EventIdAlreadyUsedError, InsufficientStockError, ProductNotFoundError } from '../../../domain/errors';
import { STOCK_MOVEMENT_LIMITS, STOCK_MOVEMENT_TYPES, createStockMovementDraft } from '../../../domain/StockMovement';
import { ProductDto, StockMovementDto, toProductDto, toStockMovementDto } from '../../dtos';
import { ProductRepository } from '../../ports/ProductRepository';
import { StockMovementRepository } from '../../ports/StockMovementRepository';
import { validate } from '../../validation';

export const registerStockMovementSchema = z.object(
  {
    type: z.enum(STOCK_MOVEMENT_TYPES, {
      required_error: 'Informe o tipo: ENTRADA ou SAIDA.',
      invalid_type_error: 'Tipo inválido. Use ENTRADA ou SAIDA.',
    }),
    quantity: z
      .number({ required_error: 'Informe a quantidade.', invalid_type_error: 'A quantidade deve ser um número inteiro.' })
      .int('A quantidade deve ser um número inteiro.')
      .min(1, 'A quantidade deve ser maior que zero.')
      .max(STOCK_MOVEMENT_LIMITS.quantityMax, `A quantidade máxima por movimentação é ${STOCK_MOVEMENT_LIMITS.quantityMax}.`),
    reason: z
      .string({ invalid_type_error: 'O motivo deve ser um texto.' })
      .trim()
      .max(STOCK_MOVEMENT_LIMITS.reasonMax, `O motivo deve ter no máximo ${STOCK_MOVEMENT_LIMITS.reasonMax} caracteres.`)
      .nullish(),
    eventId: z
      .string({ invalid_type_error: 'O eventId deve ser um texto.' })
      .trim()
      .max(STOCK_MOVEMENT_LIMITS.eventIdMax, `O eventId deve ter no máximo ${STOCK_MOVEMENT_LIMITS.eventIdMax} caracteres.`)
      .nullish(),
  },
  { required_error: 'Envie os dados da movimentação em JSON.', invalid_type_error: 'O corpo deve ser um objeto JSON.' },
);

export type RegisterStockMovementInput = z.input<typeof registerStockMovementSchema>;

export interface RegisterStockMovementResult {
  movement: StockMovementDto;
  product: ProductDto;
  /** true quando o eventId já tinha sido aplicado antes (nada mudou nesta chamada). */
  duplicate: boolean;
}

export interface RegisterStockMovementDeps {
  products: ProductRepository;
  movements: StockMovementRepository;
  now?: () => Date;
}

export class RegisterStockMovementHandler {
  private readonly now: () => Date;

  constructor(private readonly deps: RegisterStockMovementDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(productId: string, input: unknown): Promise<RegisterStockMovementResult> {
    const data = validate(registerStockMovementSchema, input);

    const draft = createStockMovementDraft({
      id: randomUUID(),
      productId,
      type: data.type,
      quantity: data.quantity,
      reason: data.reason,
      eventId: data.eventId,
      now: this.now(),
    });

    // Toda a parte delicada (não deixar o saldo negativo com chamadas concorrentes e não
    // aplicar o mesmo evento duas vezes) fica dentro do repositório, numa operação atômica.
    const result = await this.deps.movements.apply(draft);

    switch (result.outcome) {
      case 'applied':
        return {
          movement: toStockMovementDto(result.movement),
          product: toProductDto(result.product),
          duplicate: false,
        };

      case 'duplicate': {
        // A fila entrega "pelo menos uma vez": se o evento voltar, respondemos com o que já foi feito.
        if (result.movement.productId !== productId) {
          throw new EventIdAlreadyUsedError(draft.eventId ?? '');
        }
        const product = await this.deps.products.findById(productId);
        if (!product) throw new ProductNotFoundError(productId);
        return {
          movement: toStockMovementDto(result.movement),
          product: toProductDto(product),
          duplicate: true,
        };
      }

      case 'insufficient_stock':
        throw new InsufficientStockError({
          productId: result.product.id,
          productName: result.product.name,
          requested: draft.quantity,
          available: result.product.stock,
        });

      case 'product_not_found':
        throw new ProductNotFoundError(productId);
    }
  }
}
