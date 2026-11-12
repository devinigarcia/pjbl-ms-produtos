import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SkuAlreadyExistsError } from '../../src/domain/errors';
import { NewProductInput, Product } from '../../src/domain/Product';
import { StockMovementDraft, createInitialStockMovement, createStockMovementDraft } from '../../src/domain/StockMovement';
import { Repositories } from './testApp';

// "Contrato" dos repositórios: a mesma bateria de testes roda contra a implementação em memória
// (tests/unit) e contra o MongoDB de verdade (tests/integration). Assim temos certeza de que o
// repositório falso usado nos outros testes se comporta igual ao real.

const t0 = new Date('2026-01-10T12:00:00.000Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

function product(overrides: Partial<NewProductInput> = {}): Product {
  return Product.create({
    id: randomUUID(),
    sku: 'CAFE-500G',
    name: 'Café torrado 500g',
    description: 'Torra média',
    category: 'Mercearia',
    price: 24.9,
    stock: 5,
    now: t0,
    ...overrides,
  });
}

function movement(productId: string, overrides: Partial<Omit<StockMovementDraft, 'id' | 'productId'>> = {}): StockMovementDraft {
  return createStockMovementDraft({
    id: randomUUID(),
    productId,
    type: overrides.type ?? 'SAIDA',
    quantity: overrides.quantity ?? 1,
    reason: overrides.reason,
    eventId: overrides.eventId,
    now: overrides.createdAt ?? at(1),
  });
}

/**
 * @param getRepositories devolve repositórios apontando para um banco VAZIO (chamado a cada teste)
 */
export function describeRepositoryContract(label: string, getRepositories: () => Promise<Repositories> | Repositories): void {
  describe(`contrato dos repositórios — ${label}`, () => {
    let repos: Repositories;

    beforeEach(async () => {
      repos = await getRepositories();
    });

    describe('ProductRepository', () => {
      it('grava e recupera um produto sem perder nenhum campo', async () => {
        const original = product();
        await repos.products.insert(original);

        const found = await repos.products.findById(original.id);

        expect(found?.toProps()).toEqual(original.toProps());
        expect(await repos.products.findById('nao-existe')).toBeNull();
      });

      it('não deixa dois produtos com o mesmo SKU', async () => {
        await repos.products.insert(product());

        await expect(repos.products.insert(product({ name: 'Outro' }))).rejects.toBeInstanceOf(SkuAlreadyExistsError);
        expect((await repos.products.list({ page: 1, pageSize: 10 })).total).toBe(1);
      });

      it('updateDetails grava os dados cadastrais sem tocar no estoque', async () => {
        const original = product({ stock: 5 });
        await repos.products.insert(original);
        await repos.movements.apply(movement(original.id, { type: 'SAIDA', quantity: 2 }));

        // "original" ainda acha que o estoque é 5; o banco já está em 3
        original.update({ sku: 'CAFE-1KG', name: 'Café 1kg', description: '', category: 'Cafés', price: 40 }, at(5));
        const saved = await repos.products.updateDetails(original);

        expect(saved?.toProps()).toMatchObject({
          sku: 'CAFE-1KG',
          name: 'Café 1kg',
          description: '',
          category: 'Cafés',
          price: 40,
          stock: 3,
          createdAt: t0,
          updatedAt: at(5),
        });
        expect((await repos.products.findById(original.id))?.toProps()).toEqual(saved?.toProps());
      });

      it('updateDetails devolve null para produto inexistente e recusa SKU de outro produto', async () => {
        const coffee = product();
        const tea = product({ sku: 'CHA-VERDE', name: 'Chá verde' });
        await repos.products.insert(coffee);
        await repos.products.insert(tea);

        expect(await repos.products.updateDetails(product({ sku: 'FANTASMA' }))).toBeNull();

        tea.update({ sku: 'CAFE-500G', name: 'Chá verde', category: 'Mercearia', price: 9 }, at(2));
        await expect(repos.products.updateDetails(tea)).rejects.toBeInstanceOf(SkuAlreadyExistsError);
        expect((await repos.products.findById(tea.id))?.sku).toBe('CHA-VERDE');
      });

      it('lista em ordem alfabética (sem diferenciar maiúsculas), com paginação e total', async () => {
        for (const [sku, name] of [
          ['P-BANANA', 'banana prata'],
          ['P-CAFE', 'Café torrado'],
          ['P-ABACAXI', 'Abacaxi pérola'],
          ['P-DOCE', 'doce de leite'],
          ['P-ERVILHA', 'Ervilha em conserva'],
        ]) {
          await repos.products.insert(product({ sku, name }));
        }

        const first = await repos.products.list({ page: 1, pageSize: 2 });
        const third = await repos.products.list({ page: 3, pageSize: 2 });

        expect(first.total).toBe(5);
        expect(first.items.map((p) => p.name)).toEqual(['Abacaxi pérola', 'banana prata']);
        expect(third.items.map((p) => p.name)).toEqual(['Ervilha em conserva']);
      });

      it('filtra por busca (nome ou SKU), categoria e lista de ids', async () => {
        const coffee = product({ sku: 'CAFE-500G', name: 'Café torrado 500g', category: 'Mercearia' });
        const juice = product({ sku: 'SUCO-UVA', name: 'Suco integral', category: 'Bebidas' });
        const water = product({ sku: 'AGUA-COCO', name: 'Água de coco (1L)', category: 'Bebidas' });
        for (const p of [coffee, juice, water]) await repos.products.insert(p);
        const page = { page: 1, pageSize: 10 };

        const byName = await repos.products.list({ ...page, search: 'CAFÉ' });
        const bySku = await repos.products.list({ ...page, search: 'uva' });
        const withSymbols = await repos.products.list({ ...page, search: '(1L)' });
        const byCategory = await repos.products.list({ ...page, category: 'bebidas' });
        const byIds = await repos.products.list({ ...page, ids: [juice.id, coffee.id, 'nao-existe'] });
        const combined = await repos.products.list({ ...page, category: 'Bebidas', search: 'suco', ids: [juice.id, coffee.id] });

        expect(byName.items.map((p) => p.sku)).toEqual(['CAFE-500G']);
        expect(bySku.items.map((p) => p.sku)).toEqual(['SUCO-UVA']);
        expect(withSymbols.items.map((p) => p.sku)).toEqual(['AGUA-COCO']);
        expect(byCategory.items.map((p) => p.sku)).toEqual(['AGUA-COCO', 'SUCO-UVA']);
        expect(byIds).toMatchObject({ total: 2 });
        expect(byIds.items.map((p) => p.sku)).toEqual(['CAFE-500G', 'SUCO-UVA']);
        expect(combined.items.map((p) => p.sku)).toEqual(['SUCO-UVA']);
      });

      it('delete informa se o produto existia', async () => {
        const original = product();
        await repos.products.insert(original);

        expect(await repos.products.delete(original.id)).toBe(true);
        expect(await repos.products.delete(original.id)).toBe(false);
        expect(await repos.products.findById(original.id)).toBeNull();
      });
    });

    describe('StockMovementRepository', () => {
      it('apply registra entrada e saída, atualizando saldo e updatedAt do produto', async () => {
        const item = product({ stock: 5 });
        await repos.products.insert(item);

        const entrada = await repos.movements.apply(movement(item.id, { type: 'ENTRADA', quantity: 10, createdAt: at(1) }));
        const saida = await repos.movements.apply(movement(item.id, { type: 'SAIDA', quantity: 15, createdAt: at(2) }));

        expect(entrada).toMatchObject({ outcome: 'applied', movement: { balanceAfter: 15, eventId: null } });
        expect(saida).toMatchObject({ outcome: 'applied', movement: { balanceAfter: 0 } });
        if (saida.outcome !== 'applied') throw new Error('era esperado "applied"');
        expect(saida.product.stock).toBe(0);
        expect(saida.product.updatedAt).toEqual(at(2));
        expect((await repos.products.findById(item.id))?.stock).toBe(0);
      });

      it('apply recusa saída maior que o saldo e não deixa rastro', async () => {
        const item = product({ stock: 2 });
        await repos.products.insert(item);

        const result = await repos.movements.apply(movement(item.id, { type: 'SAIDA', quantity: 3, eventId: 'evt-1' }));

        expect(result.outcome).toBe('insufficient_stock');
        if (result.outcome !== 'insufficient_stock') throw new Error('era esperado "insufficient_stock"');
        expect(result.product.stock).toBe(2);
        expect((await repos.movements.listByProduct(item.id, 10)).total).toBe(0);

        // como nada ficou gravado, o mesmo eventId pode ser aplicado depois que o estoque for reposto
        await repos.movements.apply(movement(item.id, { type: 'ENTRADA', quantity: 5 }));
        const retry = await repos.movements.apply(movement(item.id, { type: 'SAIDA', quantity: 3, eventId: 'evt-1' }));
        expect(retry).toMatchObject({ outcome: 'applied', movement: { balanceAfter: 4 } });
      });

      it('apply avisa quando o produto não existe e não grava a movimentação', async () => {
        const result = await repos.movements.apply(movement('produto-fantasma', { type: 'ENTRADA', quantity: 1 }));

        expect(result.outcome).toBe('product_not_found');
        expect((await repos.movements.listByProduct('produto-fantasma', 10)).total).toBe(0);
      });

      it('apply com eventId repetido devolve a movimentação original e não mexe no saldo', async () => {
        const item = product({ stock: 5 });
        await repos.products.insert(item);

        const first = await repos.movements.apply(movement(item.id, { type: 'SAIDA', quantity: 2, eventId: 'evt-9:x' }));
        const again = await repos.movements.apply(movement(item.id, { type: 'SAIDA', quantity: 2, eventId: 'evt-9:x', createdAt: at(9) }));

        if (first.outcome !== 'applied') throw new Error('era esperado "applied"');
        expect(again.outcome).toBe('duplicate');
        if (again.outcome !== 'duplicate') throw new Error('era esperado "duplicate"');
        expect(again.movement).toEqual(first.movement);
        expect((await repos.products.findById(item.id))?.stock).toBe(3);
        expect((await repos.movements.listByProduct(item.id, 10)).total).toBe(1);
      });

      it('movimentações sem eventId nunca são tratadas como repetidas', async () => {
        const item = product({ stock: 5 });
        await repos.products.insert(item);

        const results = [];
        for (let i = 0; i < 3; i++) {
          results.push(await repos.movements.apply(movement(item.id, { type: 'SAIDA', quantity: 1 })));
        }

        expect(results.map((r) => r.outcome)).toEqual(['applied', 'applied', 'applied']);
        expect((await repos.products.findById(item.id))?.stock).toBe(2);
      });

      it('lista do mais recente para o mais antigo, com limite e total; append não altera o saldo', async () => {
        const item = product({ stock: 12 });
        const other = product({ sku: 'CHA-VERDE', stock: 1 });
        await repos.products.insert(item);
        await repos.products.insert(other);
        await repos.movements.append(createInitialStockMovement({ id: randomUUID(), productId: item.id, quantity: 12, now: t0 }));
        await repos.movements.apply(movement(item.id, { type: 'SAIDA', quantity: 2, createdAt: at(1), eventId: 'evt-a' }));
        await repos.movements.apply(movement(item.id, { type: 'ENTRADA', quantity: 5, createdAt: at(2) }));
        await repos.movements.apply(movement(other.id, { type: 'SAIDA', quantity: 1, createdAt: at(3) }));

        const all = await repos.movements.listByProduct(item.id, 50);
        const limited = await repos.movements.listByProduct(item.id, 2);

        expect(all.total).toBe(3);
        expect(all.items.map((m) => [m.type, m.quantity, m.balanceAfter, m.reason, m.eventId])).toEqual([
          ['ENTRADA', 5, 15, 'Entrada de estoque', null],
          ['SAIDA', 2, 10, 'Saída de estoque', 'evt-a'],
          ['ENTRADA', 12, 12, 'Estoque inicial', null],
        ]);
        expect(all.items[2]?.createdAt).toEqual(t0);
        expect(limited.total).toBe(3);
        expect(limited.items.map((m) => m.balanceAfter)).toEqual([15, 10]);
        expect((await repos.products.findById(item.id))?.stock).toBe(15);
      });

      it('deleteByProduct apaga só o histórico do produto informado', async () => {
        const item = product({ stock: 5 });
        const other = product({ sku: 'CHA-VERDE', stock: 5 });
        await repos.products.insert(item);
        await repos.products.insert(other);
        await repos.movements.apply(movement(item.id));
        await repos.movements.apply(movement(other.id));

        await repos.movements.deleteByProduct(item.id);

        expect((await repos.movements.listByProduct(item.id, 10)).total).toBe(0);
        expect((await repos.movements.listByProduct(other.id, 10)).total).toBe(1);
      });
    });
  });
}
