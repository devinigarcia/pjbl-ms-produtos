import { Collection, Filter } from 'mongodb';
import { ProductFilter, ProductPage, ProductRepository } from '../../application/ports/ProductRepository';
import { SkuAlreadyExistsError } from '../../domain/errors';
import { Product } from '../../domain/Product';
import { ProductDocument, escapeRegex, isDuplicateKeyError } from './mongoConnection';

// Ordenação por nome ignorando maiúsculas/minúsculas ("abacaxi" antes de "Banana").
const NAME_COLLATION = { locale: 'pt', strength: 2 } as const;

export function toProduct(doc: ProductDocument): Product {
  return Product.restore({
    id: doc._id,
    sku: doc.sku,
    name: doc.name,
    description: doc.description,
    category: doc.category,
    price: doc.price,
    stock: doc.stock,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
}

function toDocument(product: Product): ProductDocument {
  const { id, ...rest } = product.toProps();
  return { _id: id, ...rest };
}

export class MongoProductRepository implements ProductRepository {
  constructor(private readonly products: Collection<ProductDocument>) {}

  async insert(product: Product): Promise<void> {
    try {
      await this.products.insertOne(toDocument(product));
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new SkuAlreadyExistsError(product.sku);
      throw error;
    }
  }

  async updateDetails(product: Product): Promise<Product | null> {
    try {
      // Só os dados cadastrais entram no $set. O estoque fica de fora para não
      // atropelar uma movimentação que esteja acontecendo ao mesmo tempo.
      const updated = await this.products.findOneAndUpdate(
        { _id: product.id },
        {
          $set: {
            sku: product.sku,
            name: product.name,
            description: product.description,
            category: product.category,
            price: product.price,
            updatedAt: product.updatedAt,
          },
        },
        { returnDocument: 'after' },
      );
      return updated ? toProduct(updated) : null;
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new SkuAlreadyExistsError(product.sku);
      throw error;
    }
  }

  async findById(id: string): Promise<Product | null> {
    const doc = await this.products.findOne({ _id: id });
    return doc ? toProduct(doc) : null;
  }

  async list(filter: ProductFilter): Promise<ProductPage> {
    const query: Filter<ProductDocument> = {};

    if (filter.search) {
      const pattern = new RegExp(escapeRegex(filter.search), 'i');
      query.$or = [{ name: pattern }, { sku: pattern }];
    }
    if (filter.category) {
      query.category = new RegExp(`^${escapeRegex(filter.category)}$`, 'i');
    }
    if (filter.ids) {
      query._id = { $in: filter.ids };
    }

    const [docs, total] = await Promise.all([
      this.products
        .find(query)
        .collation(NAME_COLLATION)
        .sort({ name: 1, sku: 1 })
        .skip((filter.page - 1) * filter.pageSize)
        .limit(filter.pageSize)
        .toArray(),
      this.products.countDocuments(query, { collation: NAME_COLLATION }),
    ]);

    return { items: docs.map(toProduct), total };
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.products.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }
}
