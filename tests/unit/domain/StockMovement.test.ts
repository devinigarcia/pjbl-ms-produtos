import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/domain/errors';
import {
  INITIAL_STOCK_REASON,
  createInitialStockMovement,
  createStockMovementDraft,
  stockDelta,
} from '../../../src/domain/StockMovement';

const now = new Date('2026-01-10T12:00:00.000Z');

describe('StockMovement (domínio)', () => {
  it('cria a movimentação com motivo padrão e sem eventId', () => {
    const entrada = createStockMovementDraft({ id: 'm-1', productId: 'p-1', type: 'ENTRADA', quantity: 10, now });
    const saida = createStockMovementDraft({ id: 'm-2', productId: 'p-1', type: 'SAIDA', quantity: 1, reason: '   ', now });

    expect(entrada).toEqual({
      id: 'm-1',
      productId: 'p-1',
      type: 'ENTRADA',
      quantity: 10,
      reason: 'Entrada de estoque',
      eventId: null,
      createdAt: now,
    });
    expect(saida.reason).toBe('Saída de estoque');
  });

  it('guarda motivo e eventId informados, sem espaços nas pontas', () => {
    const draft = createStockMovementDraft({
      id: 'm-1',
      productId: 'p-1',
      type: 'SAIDA',
      quantity: 2,
      reason: '  Pedido 123 criado ',
      eventId: ' evt-1:p-1 ',
      now,
    });

    expect(draft.reason).toBe('Pedido 123 criado');
    expect(draft.eventId).toBe('evt-1:p-1');
  });

  it.each([0, -1, 2.5, Number.NaN])('recusa a quantidade %s', (quantity) => {
    expect(() => createStockMovementDraft({ id: 'm-1', productId: 'p-1', type: 'ENTRADA', quantity, now })).toThrow(
      ValidationError,
    );
  });

  it('recusa tipo desconhecido e motivo longo demais, apontando os dois campos', () => {
    try {
      createStockMovementDraft({
        id: 'm-1',
        productId: 'p-1',
        type: 'AJUSTE' as never,
        quantity: 1,
        reason: 'x'.repeat(201),
        now,
      });
      expect.unreachable('deveria ter lançado ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues.map((issue) => issue.field)).toEqual(['type', 'reason']);
    }
  });

  it('calcula o efeito no saldo: ENTRADA positiva, SAIDA negativa', () => {
    expect(stockDelta('ENTRADA', 7)).toBe(7);
    expect(stockDelta('SAIDA', 7)).toBe(-7);
  });

  it('monta a movimentação de estoque inicial já com o saldo', () => {
    const movement = createInitialStockMovement({ id: 'm-1', productId: 'p-1', quantity: 12, now });

    expect(movement).toMatchObject({
      type: 'ENTRADA',
      quantity: 12,
      reason: INITIAL_STOCK_REASON,
      eventId: null,
      balanceAfter: 12,
    });
  });
});
