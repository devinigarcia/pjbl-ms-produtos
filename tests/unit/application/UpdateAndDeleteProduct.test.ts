import { describe, expect, it } from 'vitest';
import { ProductNotFoundError, SkuAlreadyExistsError, ValidationError } from '../../../src/domain/errors';
import { buildHandlers, inMemoryRepositories, sampleProduct } from '../../support/testApp';

describe('UpdateProduct (caso de uso)', () => {
  it('atualiza os dados cadastrais e ignora o campo stock do corpo', async () => {
    const handlers = buildHandlers();
    const created = await handlers.createProduct.execute(sampleProduct);

    const updated = await handlers.updateProduct.execute(created.id, {
      name: 'Café especial 500g',
      category: 'Cafés',
      price: 31.999,
      stock: 999, // não deve ter efeito nenhum
    });

    expect(updated).toMatchObject({
      id: created.id,
      sku: 'CAFE-500G',
      name: 'Café especial 500g',
      description: 'Torra média',
      category: 'Cafés',
      price: 32,
      stock: 12,
      createdAt: created.createdAt,
    });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());
    expect(await handlers.getProduct.execute(created.id)).toEqual(updated);
  });

  it('permite trocar o SKU, mas não para um que já pertence a outro produto', async () => {
    const handlers = buildHandlers();
    const coffee = await handlers.createProduct.execute(sampleProduct);
    await handlers.createProduct.execute({ ...sampleProduct, sku: 'CHA-VERDE', name: 'Chá verde' });
    const base = { name: coffee.name, category: coffee.category, price: coffee.price };

    const renamed = await handlers.updateProduct.execute(coffee.id, { ...base, sku: 'cafe-500g-v2' });
    expect(renamed.sku).toBe('CAFE-500G-V2');

    // reenviar o próprio SKU não é conflito
    await expect(handlers.updateProduct.execute(coffee.id, { ...base, sku: 'CAFE-500G-V2' })).resolves.toBeDefined();

    await expect(handlers.updateProduct.execute(coffee.id, { ...base, sku: 'cha-verde' })).rejects.toBeInstanceOf(
      SkuAlreadyExistsError,
    );
    expect((await handlers.getProduct.execute(coffee.id)).sku).toBe('CAFE-500G-V2');
  });

  it('valida antes de procurar o produto e avisa quando ele não existe', async () => {
    const handlers = buildHandlers();

    await expect(handlers.updateProduct.execute('nao-existe', { name: 'X' })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      handlers.updateProduct.execute('nao-existe', { name: 'Produto', category: 'Geral', price: 10 }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('não desfaz uma movimentação de estoque que aconteceu depois de o produto ser carregado', async () => {
    const repositories = inMemoryRepositories();
    const handlers = buildHandlers(repositories);
    const created = await handlers.createProduct.execute(sampleProduct);

    // Simula a corrida: o produto é lido com estoque 12, entra uma saída de 2 e só então o PUT grava.
    const stale = (await repositories.products.findById(created.id))!;
    await handlers.registerStockMovement.execute(created.id, { type: 'SAIDA', quantity: 2 });
    stale.update({ name: 'Nome novo', category: 'Mercearia', price: 20 }, new Date());
    const saved = await repositories.products.updateDetails(stale);

    expect(saved?.name).toBe('Nome novo');
    expect(saved?.stock).toBe(10);
  });
});

describe('DeleteProduct (caso de uso)', () => {
  it('exclui o produto junto com o histórico de movimentações, sem tocar nos outros', async () => {
    const repositories = inMemoryRepositories();
    const handlers = buildHandlers(repositories);
    const coffee = await handlers.createProduct.execute(sampleProduct);
    const tea = await handlers.createProduct.execute({ ...sampleProduct, sku: 'CHA-VERDE', name: 'Chá verde', stock: 4 });
    await handlers.registerStockMovement.execute(coffee.id, { type: 'SAIDA', quantity: 1 });

    await handlers.deleteProduct.execute(coffee.id);

    await expect(handlers.getProduct.execute(coffee.id)).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(repositories.db.movements.map((m) => m.productId)).toEqual([tea.id]);
    expect((await handlers.listProducts.execute({})).total).toBe(1);
  });

  it('avisa quando o produto não existe', async () => {
    const handlers = buildHandlers();
    await expect(handlers.deleteProduct.execute('nao-existe')).rejects.toBeInstanceOf(ProductNotFoundError);
  });
});
