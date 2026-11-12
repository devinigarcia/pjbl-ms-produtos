import { beforeEach, describe, expect, it } from 'vitest';
import { Handlers } from '../../../src/application/handlers';
import { ProductNotFoundError, ValidationError } from '../../../src/domain/errors';
import { buildHandlers } from '../../support/testApp';

describe('ListProducts e GetProduct (casos de uso)', () => {
  let handlers: Handlers;
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    handlers = buildHandlers();
    const catalog = [
      { sku: 'CAFE-500G', name: 'Café torrado 500g', category: 'Mercearia', price: 24.9, stock: 12 },
      { sku: 'ACUCAR-1KG', name: 'açúcar cristal 1kg', category: 'Mercearia', price: 5.49, stock: 3 },
      { sku: 'SUCO-UVA', name: 'Suco de uva integral', category: 'Bebidas', price: 14.0 },
      { sku: 'AGUA-COCO', name: 'Água de coco 1L', category: 'Bebidas', price: 8.9, stock: 40 },
      { sku: 'DETERGENTE', name: 'Detergente neutro', category: 'Limpeza', price: 2.99, stock: 6 },
    ];
    for (const item of catalog) {
      ids[item.sku] = (await handlers.createProduct.execute(item)).id;
    }
  });

  it('lista em ordem alfabética de nome com os padrões page=1 e pageSize=20', async () => {
    const result = await handlers.listProducts.execute({});

    expect(result).toMatchObject({ total: 5, page: 1, pageSize: 20 });
    expect(result.items.map((p) => p.sku)).toEqual(['ACUCAR-1KG', 'AGUA-COCO', 'CAFE-500G', 'DETERGENTE', 'SUCO-UVA']);
    expect(result.items.map((p) => p.lowStock)).toEqual([true, false, false, false, true]);
  });

  it('pagina o resultado (a query string chega como texto)', async () => {
    const secondPage = await handlers.listProducts.execute({ page: '2', pageSize: '2' });
    const beyond = await handlers.listProducts.execute({ page: '9', pageSize: '2' });

    expect(secondPage).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(secondPage.items.map((p) => p.sku)).toEqual(['CAFE-500G', 'DETERGENTE']);
    expect(beyond).toMatchObject({ total: 5, items: [] });
  });

  it('busca por trecho do nome ou do SKU, sem diferenciar maiúsculas', async () => {
    const byName = await handlers.listProducts.execute({ search: 'CAFÉ' });
    const bySku = await handlers.listProducts.execute({ search: 'uva' });
    const nothing = await handlers.listProducts.execute({ search: 'chocolate' });

    expect(byName.items.map((p) => p.sku)).toEqual(['CAFE-500G']);
    expect(bySku.items.map((p) => p.sku)).toEqual(['SUCO-UVA']);
    expect(nothing).toMatchObject({ items: [], total: 0 });
  });

  it('filtra por categoria e combina com a busca', async () => {
    const drinks = await handlers.listProducts.execute({ category: 'bebidas' });
    const combined = await handlers.listProducts.execute({ category: 'Bebidas', search: 'coco' });

    expect(drinks.items.map((p) => p.sku)).toEqual(['AGUA-COCO', 'SUCO-UVA']);
    expect(combined.items.map((p) => p.sku)).toEqual(['AGUA-COCO']);
  });

  it('filtra por lista de ids (formato usado pelo BFF) ignorando ids que não existem', async () => {
    const result = await handlers.listProducts.execute({
      ids: `${ids['SUCO-UVA']}, ${ids['CAFE-500G']},nao-existe,${ids['CAFE-500G']}`,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((p) => p.sku)).toEqual(['CAFE-500G', 'SUCO-UVA']);
  });

  it('trata filtros vazios como não informados', async () => {
    const result = await handlers.listProducts.execute({ search: '  ', category: '', ids: '' });
    expect(result.total).toBe(5);
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ pageSize: '101' }, 'pageSize'],
    [{ pageSize: 'abc' }, 'pageSize'],
    [{ page: '1.5' }, 'page'],
  ])('recusa paginação inválida %o', async (query, field) => {
    const attempt = handlers.listProducts.execute(query);

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toMatchObject({ details: [{ field }] });
  });

  it('busca um produto pelo id e avisa quando ele não existe', async () => {
    const product = await handlers.getProduct.execute(ids['AGUA-COCO']!);
    expect(product).toMatchObject({ sku: 'AGUA-COCO', stock: 40, lowStock: false });

    const attempt = handlers.getProduct.execute('id-que-nao-existe');
    await expect(attempt).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(attempt).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });
});
