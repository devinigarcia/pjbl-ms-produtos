import { describe, expect, it } from 'vitest';
import { SkuAlreadyExistsError, ValidationError } from '../../../src/domain/errors';
import { buildHandlers, inMemoryRepositories, sampleProduct } from '../../support/testApp';

describe('CreateProduct (caso de uso)', () => {
  it('cadastra o produto e registra o estoque inicial como movimentação de ENTRADA', async () => {
    const repositories = inMemoryRepositories();
    const { createProduct } = buildHandlers(repositories);

    const product = await createProduct.execute(sampleProduct);

    expect(product).toMatchObject({
      sku: 'CAFE-500G',
      name: 'Café torrado 500g',
      description: 'Torra média',
      category: 'Mercearia',
      price: 24.9,
      stock: 12,
      lowStock: false,
    });
    expect(product.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(product.createdAt).toBe(product.updatedAt);

    const history = await repositories.movements.listByProduct(product.id, 10);
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({
      type: 'ENTRADA',
      quantity: 12,
      reason: 'Estoque inicial',
      eventId: null,
      balanceAfter: 12,
    });
  });

  it('sem estoque inicial o produto começa zerado e sem histórico', async () => {
    const repositories = inMemoryRepositories();
    const { createProduct } = buildHandlers(repositories);

    const product = await createProduct.execute({ sku: 'filtro-103', name: 'Filtro 103', category: 'Mercearia', price: 6.5 });

    expect(product).toMatchObject({ sku: 'FILTRO-103', description: '', stock: 0, lowStock: true });
    expect((await repositories.movements.listByProduct(product.id, 10)).total).toBe(0);
  });

  it('recusa SKU repetido, mesmo escrito em minúsculas', async () => {
    const repositories = inMemoryRepositories();
    const { createProduct } = buildHandlers(repositories);
    await createProduct.execute(sampleProduct);

    const attempt = createProduct.execute({ ...sampleProduct, sku: 'cafe-500g', name: 'Outro café' });

    await expect(attempt).rejects.toBeInstanceOf(SkuAlreadyExistsError);
    await expect(attempt).rejects.toMatchObject({ code: 'SKU_ALREADY_EXISTS' });
    expect(repositories.db.products.size).toBe(1);
    expect(repositories.db.movements).toHaveLength(1);
  });

  it('valida a entrada e aponta cada campo com problema', async () => {
    const repositories = inMemoryRepositories();
    const { createProduct } = buildHandlers(repositories);

    const attempt = createProduct.execute({ sku: 'a', name: '', price: 0, stock: 1.5 });

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toMatchObject({
      details: [
        { field: 'sku', message: expect.stringContaining('SKU inválido') },
        { field: 'name', message: 'O nome deve ter no mínimo 2 caracteres.' },
        { field: 'category', message: 'Informe a categoria.' },
        { field: 'price', message: 'Deve ser maior que zero.' },
        { field: 'stock', message: 'O estoque deve ser um número inteiro.' },
      ],
    });
    expect(repositories.db.products.size).toBe(0);
  });

  it('não aceita preço como texto nem corpo vazio', async () => {
    const { createProduct } = buildHandlers();

    await expect(createProduct.execute({ ...sampleProduct, price: '24.90' })).rejects.toMatchObject({
      details: [{ field: 'price', message: 'O preço deve ser um número.' }],
    });
    await expect(createProduct.execute(undefined)).rejects.toMatchObject({
      details: [{ field: 'body', message: 'Envie os dados do produto em JSON.' }],
    });
  });
});
