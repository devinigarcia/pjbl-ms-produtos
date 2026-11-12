import { beforeEach, describe, expect, it } from 'vitest';
import { Handlers } from '../../../src/application/handlers';
import {
  EventIdAlreadyUsedError,
  InsufficientStockError,
  ProductNotFoundError,
  ValidationError,
} from '../../../src/domain/errors';
import { buildHandlers, sampleProduct } from '../../support/testApp';

describe('RegisterStockMovement (caso de uso)', () => {
  let handlers: Handlers;
  let productId: string;

  beforeEach(async () => {
    handlers = buildHandlers();
    productId = (await handlers.createProduct.execute({ ...sampleProduct, stock: 5 })).id;
  });

  it('ENTRADA aumenta o saldo e devolve movimentação + produto atualizado', async () => {
    const result = await handlers.registerStockMovement.execute(productId, {
      type: 'ENTRADA',
      quantity: 10,
      reason: 'Reposição do fornecedor',
    });

    expect(result.duplicate).toBe(false);
    expect(result.movement).toMatchObject({
      productId,
      type: 'ENTRADA',
      quantity: 10,
      reason: 'Reposição do fornecedor',
      eventId: null,
      balanceAfter: 15,
    });
    expect(result.product).toMatchObject({ id: productId, stock: 15, lowStock: false });
    expect(result.product.updatedAt).toBe(result.movement.createdAt);
  });

  it('SAIDA diminui o saldo e pode zerar o estoque', async () => {
    const result = await handlers.registerStockMovement.execute(productId, { type: 'SAIDA', quantity: 5 });

    expect(result.movement).toMatchObject({ type: 'SAIDA', reason: 'Saída de estoque', balanceAfter: 0 });
    expect(result.product).toMatchObject({ stock: 0, lowStock: true });
  });

  it('recusa SAIDA maior que o saldo e não altera nada', async () => {
    const attempt = handlers.registerStockMovement.execute(productId, { type: 'SAIDA', quantity: 6 });

    await expect(attempt).rejects.toBeInstanceOf(InsufficientStockError);
    await expect(attempt).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ productId, productName: 'Café torrado 500g', requested: 6, available: 5 }],
    });
    expect((await handlers.getProduct.execute(productId)).stock).toBe(5);
    expect((await handlers.listStockMovements.execute(productId)).total).toBe(1);
  });

  it('é idempotente: o mesmo eventId só é aplicado uma vez', async () => {
    const input = { type: 'SAIDA', quantity: 2, reason: 'Pedido 77 criado', eventId: `evt-77:${productId}` };

    const first = await handlers.registerStockMovement.execute(productId, input);
    const second = await handlers.registerStockMovement.execute(productId, input);
    const third = await handlers.registerStockMovement.execute(productId, { ...input, quantity: 4 });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(true);
    // a resposta do reprocessamento traz a movimentação original e o saldo atual
    expect(second.movement).toEqual(first.movement);
    expect(third.movement.quantity).toBe(2);
    expect(second.product.stock).toBe(3);
    expect((await handlers.listStockMovements.execute(productId)).total).toBe(2);
  });

  it('eventos diferentes para o mesmo produto são aplicados normalmente', async () => {
    await handlers.registerStockMovement.execute(productId, { type: 'SAIDA', quantity: 2, eventId: `evt-1:${productId}` });
    const refund = await handlers.registerStockMovement.execute(productId, {
      type: 'ENTRADA',
      quantity: 2,
      reason: 'Pedido 1 cancelado (devolução)',
      eventId: `evt-2:${productId}`,
    });

    expect(refund.duplicate).toBe(false);
    expect(refund.product.stock).toBe(5);
  });

  it('recusa um eventId que já foi usado na movimentação de outro produto', async () => {
    const other = await handlers.createProduct.execute({ ...sampleProduct, sku: 'CHA-VERDE', name: 'Chá verde' });
    await handlers.registerStockMovement.execute(other.id, { type: 'SAIDA', quantity: 1, eventId: 'evt-compartilhado' });

    const attempt = handlers.registerStockMovement.execute(productId, { type: 'SAIDA', quantity: 1, eventId: 'evt-compartilhado' });

    await expect(attempt).rejects.toBeInstanceOf(EventIdAlreadyUsedError);
    expect((await handlers.getProduct.execute(productId)).stock).toBe(5);
  });

  it('avisa quando o produto não existe', async () => {
    await expect(
      handlers.registerStockMovement.execute('nao-existe', { type: 'ENTRADA', quantity: 1 }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it.each([
    [{ quantity: 1 }, 'type'],
    [{ type: 'AJUSTE', quantity: 1 }, 'type'],
    [{ type: 'ENTRADA' }, 'quantity'],
    [{ type: 'ENTRADA', quantity: 0 }, 'quantity'],
    [{ type: 'SAIDA', quantity: 1.5 }, 'quantity'],
    [{ type: 'SAIDA', quantity: '2' }, 'quantity'],
    [{ type: 'SAIDA', quantity: 1, reason: 'x'.repeat(201) }, 'reason'],
  ])('recusa a entrada inválida %o', async (input, field) => {
    const attempt = handlers.registerStockMovement.execute(productId, input);

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toMatchObject({ details: [{ field }] });
  });
});

describe('ListStockMovements (caso de uso)', () => {
  it('lista as movimentações da mais recente para a mais antiga, respeitando o limite', async () => {
    const handlers = buildHandlers();
    const { id } = await handlers.createProduct.execute({ ...sampleProduct, stock: 5 });
    await handlers.registerStockMovement.execute(id, { type: 'ENTRADA', quantity: 10 });
    await handlers.registerStockMovement.execute(id, { type: 'SAIDA', quantity: 3 });

    const all = await handlers.listStockMovements.execute(id);
    const limited = await handlers.listStockMovements.execute(id, { limit: '2' });

    expect(all.total).toBe(3);
    expect(all.items.map((m) => [m.type, m.quantity, m.balanceAfter])).toEqual([
      ['SAIDA', 3, 12],
      ['ENTRADA', 10, 15],
      ['ENTRADA', 5, 5],
    ]);
    expect(all.items[2]?.reason).toBe('Estoque inicial');
    expect(limited.total).toBe(3);
    expect(limited.items).toHaveLength(2);
  });

  it('só mostra as movimentações do produto pedido', async () => {
    const handlers = buildHandlers();
    const coffee = await handlers.createProduct.execute(sampleProduct);
    const tea = await handlers.createProduct.execute({ ...sampleProduct, sku: 'CHA-VERDE', name: 'Chá verde', stock: 0 });
    await handlers.registerStockMovement.execute(tea.id, { type: 'ENTRADA', quantity: 7 });

    expect((await handlers.listStockMovements.execute(coffee.id)).items.map((m) => m.productId)).toEqual([coffee.id]);
    expect((await handlers.listStockMovements.execute(tea.id)).items.map((m) => m.quantity)).toEqual([7]);
  });

  it('avisa quando o produto não existe e recusa limite fora da faixa', async () => {
    const handlers = buildHandlers();
    const { id } = await handlers.createProduct.execute(sampleProduct);

    await expect(handlers.listStockMovements.execute('nao-existe')).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(handlers.listStockMovements.execute(id, { limit: '201' })).rejects.toBeInstanceOf(ValidationError);
    await expect(handlers.listStockMovements.execute(id, { limit: '0' })).rejects.toBeInstanceOf(ValidationError);
  });
});
