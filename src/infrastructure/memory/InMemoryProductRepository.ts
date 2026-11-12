import { ProductFilter, ProductPage, ProductRepository } from '../../application/ports/ProductRepository';
import { SkuAlreadyExistsError } from '../../domain/errors';
import { Product, ProductProps } from '../../domain/Product';
import { InMemoryDatabase } from './InMemoryDatabase';

export class InMemoryProductRepository implements ProductRepository {
  constructor(private readonly db: InMemoryDatabase = new InMemoryDatabase()) {}

  async insert(product: Product): Promise<void> {
    this.assertSkuIsFree(product.sku, product.id);
    this.db.products.set(product.id, product.toProps());
  }

  async updateDetails(product: Product): Promise<Product | null> {
    const current = this.db.products.get(product.id);
    if (!current) return null;
    this.assertSkuIsFree(product.sku, product.id);

    // Igual ao Mongo: o estoque guardado não é tocado aqui.
    const next: ProductProps = { ...product.toProps(), stock: current.stock, createdAt: current.createdAt };
    this.db.products.set(product.id, next);
    return Product.restore(next);
  }

  async findById(id: string): Promise<Product | null> {
    const props = this.db.products.get(id);
    return props ? Product.restore(props) : null;
  }

  async list(filter: ProductFilter): Promise<ProductPage> {
    const search = filter.search?.toLowerCase();
    const category = filter.category?.toLowerCase();
    const ids = filter.ids ? new Set(filter.ids) : undefined;

    const matches = [...this.db.products.values()]
      .filter((p) => !ids || ids.has(p.id))
      .filter((p) => !category || p.category.toLowerCase() === category)
      .filter((p) => !search || p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'pt', { sensitivity: 'accent' }) || a.sku.localeCompare(b.sku),
      );

    const start = (filter.page - 1) * filter.pageSize;
    return {
      items: matches.slice(start, start + filter.pageSize).map((props) => Product.restore(props)),
      total: matches.length,
    };
  }

  async delete(id: string): Promise<boolean> {
    return this.db.products.delete(id);
  }

  private assertSkuIsFree(sku: string, ownerId: string): void {
    for (const other of this.db.products.values()) {
      if (other.sku === sku && other.id !== ownerId) throw new SkuAlreadyExistsError(sku);
    }
  }
}
