import { FieldIssue, ValidationError } from './errors';

export const STOCK_MOVEMENT_TYPES = ['ENTRADA', 'SAIDA'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const INITIAL_STOCK_REASON = 'Estoque inicial';

export const STOCK_MOVEMENT_LIMITS = {
  quantityMax: 1_000_000,
  reasonMax: 200,
  eventIdMax: 200,
} as const;

/**
 * Movimentação ainda não aplicada: falta o saldo, que só é conhecido
 * no momento em que o estoque é atualizado de forma atômica no repositório.
 */
export interface StockMovementDraft {
  readonly id: string;
  readonly productId: string;
  readonly type: StockMovementType;
  readonly quantity: number;
  readonly reason: string;
  /** Chave de idempotência (ex.: "<eventId>:<productId>"). null em movimentações manuais. */
  readonly eventId: string | null;
  readonly createdAt: Date;
}

/** Movimentação já aplicada, com o saldo que o produto ficou depois dela. */
export interface StockMovement extends StockMovementDraft {
  readonly balanceAfter: number;
}

export interface NewStockMovementInput {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  reason?: string | null;
  eventId?: string | null;
  now: Date;
}

export function isStockMovementType(value: unknown): value is StockMovementType {
  return typeof value === 'string' && (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

/** Quanto a movimentação soma (ENTRADA) ou tira (SAIDA) do estoque. */
export function stockDelta(type: StockMovementType, quantity: number): number {
  return type === 'ENTRADA' ? quantity : -quantity;
}

export function defaultReason(type: StockMovementType): string {
  return type === 'ENTRADA' ? 'Entrada de estoque' : 'Saída de estoque';
}

export function createStockMovementDraft(input: NewStockMovementInput): StockMovementDraft {
  const issues: FieldIssue[] = [];

  if (!isStockMovementType(input.type)) {
    issues.push({ field: 'type', message: 'Tipo inválido. Use ENTRADA ou SAIDA.' });
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    issues.push({ field: 'quantity', message: 'A quantidade deve ser um número inteiro maior que zero.' });
  } else if (input.quantity > STOCK_MOVEMENT_LIMITS.quantityMax) {
    issues.push({ field: 'quantity', message: `A quantidade máxima por movimentação é ${STOCK_MOVEMENT_LIMITS.quantityMax}.` });
  }

  const reason = (input.reason ?? '').trim();
  if (reason.length > STOCK_MOVEMENT_LIMITS.reasonMax) {
    issues.push({ field: 'reason', message: `O motivo pode ter no máximo ${STOCK_MOVEMENT_LIMITS.reasonMax} caracteres.` });
  }

  const eventId = (input.eventId ?? '').trim();
  if (eventId.length > STOCK_MOVEMENT_LIMITS.eventIdMax) {
    issues.push({ field: 'eventId', message: `O eventId pode ter no máximo ${STOCK_MOVEMENT_LIMITS.eventIdMax} caracteres.` });
  }

  if (issues.length > 0) throw new ValidationError(issues);

  return {
    id: input.id,
    productId: input.productId,
    type: input.type,
    quantity: input.quantity,
    reason: reason || defaultReason(input.type),
    eventId: eventId || null,
    createdAt: input.now,
  };
}

/** O estoque informado no cadastro do produto entra no histórico como uma ENTRADA. */
export function createInitialStockMovement(input: {
  id: string;
  productId: string;
  quantity: number;
  now: Date;
}): StockMovement {
  const draft = createStockMovementDraft({
    id: input.id,
    productId: input.productId,
    type: 'ENTRADA',
    quantity: input.quantity,
    reason: INITIAL_STOCK_REASON,
    now: input.now,
  });
  return { ...draft, balanceAfter: input.quantity };
}
