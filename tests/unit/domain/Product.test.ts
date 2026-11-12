import { describe, expect, it } from 'vitest';
import { InsufficientStockError, ValidationError } from '../../../src/domain/errors';
import { LOW_STOCK_THRESHOLD, NewProductInput, Product, roundMoney } from '../../../src/domain/Product';

const now = new Date('2026-01-10T12:00:00.000Z');
const later = new Date('2026-01-11T08:30:00.000Z');

function newProduct(overrides: Partial<NewProductInput> = {}): Product {
  return Product.create({
    id: 'p-1',
    sku: 'CAFE-500G',
    name: 'Café torrado 500g',
    category: 'Mercearia',
    price: 24.9,
    now,
    ...overrides,
  });
}

function issuesOf(action: () => unknown): string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues.map((issue) => issue.field);
    throw error;
  }
  throw new Error('Era esperado um ValidationError, mas nada foi lançado.');
}

describe('Product (domínio)', () => {
  describe('criação', () => {
    it('normaliza o SKU para maiúsculas, apara os textos e começa com estoque zero', () => {
      const product = newProduct({ sku: '  cafe-500g ', name: '  Café torrado 500g  ', category: ' Mercearia ' });

      expect(product.sku).toBe('CAFE-500G');
      expect(product.name).toBe('Café torrado 500g');
      expect(product.category).toBe('Mercearia');
      expect(product.description).toBe('');
      expect(product.stock).toBe(0);
      expect(product.createdAt).toEqual(now);
      expect(product.updatedAt).toEqual(now);
    });

    it('arredonda o preço para 2 casas', () => {
      expect(newProduct({ price: 19.999 }).price).toBe(20);
      expect(newProduct({ price: 10.005 }).price).toBe(10.01);
      expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    });

    it.each(['AB', '-ABC', 'COM ESPACO', 'ACENTO-É', 'X'.repeat(31)])('recusa o SKU inválido "%s"', (sku) => {
      expect(issuesOf(() => newProduct({ sku }))).toEqual(['sku']);
    });

    it('recusa nome curto demais ou longo demais', () => {
      expect(issuesOf(() => newProduct({ name: 'A' }))).toEqual(['name']);
      expect(issuesOf(() => newProduct({ name: 'A'.repeat(121) }))).toEqual(['name']);
      expect(() => newProduct({ name: 'A'.repeat(120) })).not.toThrow();
    });

    it('recusa preço zero, negativo ou que vira zero depois de arredondar', () => {
      expect(issuesOf(() => newProduct({ price: 0 }))).toEqual(['price']);
      expect(issuesOf(() => newProduct({ price: -1 }))).toEqual(['price']);
      expect(issuesOf(() => newProduct({ price: 0.004 }))).toEqual(['price']);
      expect(issuesOf(() => newProduct({ price: Number.NaN }))).toEqual(['price']);
    });

    it('recusa estoque inicial negativo ou quebrado', () => {
      expect(issuesOf(() => newProduct({ stock: -1 }))).toEqual(['stock']);
      expect(issuesOf(() => newProduct({ stock: 1.5 }))).toEqual(['stock']);
    });

    it('junta todos os problemas em um único erro de validação', () => {
      const fields = issuesOf(() => newProduct({ sku: '?', name: '', category: '', price: 0, stock: -3 }));
      expect(fields).toEqual(['sku', 'name', 'category', 'price', 'stock']);
    });
  });

  describe('estoque baixo', () => {
    it(`sinaliza lowStock quando o saldo é menor ou igual a ${LOW_STOCK_THRESHOLD}`, () => {
      expect(newProduct({ stock: 0 }).lowStock).toBe(true);
      expect(newProduct({ stock: LOW_STOCK_THRESHOLD }).lowStock).toBe(true);
      expect(newProduct({ stock: LOW_STOCK_THRESHOLD + 1 }).lowStock).toBe(false);
    });
  });

  describe('atualização cadastral', () => {
    it('altera os dados, atualiza updatedAt e preserva estoque e createdAt', () => {
      const product = newProduct({ stock: 8 });

      product.update({ sku: 'cafe-1kg', name: 'Café 1kg', description: 'Pacote grande', category: 'Bebidas', price: 45.555 }, later);

      expect(product.toProps()).toEqual({
        id: 'p-1',
        sku: 'CAFE-1KG',
        name: 'Café 1kg',
        description: 'Pacote grande',
        category: 'Bebidas',
        price: 45.56,
        stock: 8,
        createdAt: now,
        updatedAt: later,
      });
    });

    it('mantém SKU e descrição quando eles não são informados', () => {
      const product = newProduct({ description: 'Torra média' });

      product.update({ name: 'Café especial', category: 'Mercearia', price: 30 }, later);

      expect(product.sku).toBe('CAFE-500G');
      expect(product.description).toBe('Torra média');
    });

    it('não muda nada se os novos dados forem inválidos', () => {
      const product = newProduct();
      const before = product.toProps();

      expect(issuesOf(() => product.update({ name: 'X', category: 'Mercearia', price: -5 }, later))).toEqual(['name', 'price']);
      expect(product.toProps()).toEqual(before);
    });
  });

  describe('movimentação de estoque', () => {
    it('ENTRADA soma e SAIDA subtrai, devolvendo o novo saldo', () => {
      const product = newProduct({ stock: 10 });

      expect(product.applyMovement('ENTRADA', 5, later)).toBe(15);
      expect(product.applyMovement('SAIDA', 15, later)).toBe(0);
      expect(product.stock).toBe(0);
      expect(product.updatedAt).toEqual(later);
    });

    it('recusa saída maior que o saldo e deixa o estoque como estava', () => {
      const product = newProduct({ stock: 3 });

      let error: unknown;
      try {
        product.applyMovement('SAIDA', 4, later);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InsufficientStockError);
      expect((error as InsufficientStockError).code).toBe('INSUFFICIENT_STOCK');
      expect((error as InsufficientStockError).details).toEqual([
        { productId: 'p-1', productName: 'Café torrado 500g', requested: 4, available: 3 },
      ]);
      expect(product.stock).toBe(3);
      expect(product.updatedAt).toEqual(now);
    });

    it('recusa quantidade zero, negativa ou fracionada', () => {
      const product = newProduct({ stock: 3 });

      for (const quantity of [0, -2, 1.5]) {
        expect(issuesOf(() => product.applyMovement('ENTRADA', quantity, later))).toEqual(['quantity']);
      }
      expect(product.stock).toBe(3);
    });
  });
});
