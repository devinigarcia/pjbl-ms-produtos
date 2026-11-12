import { Product } from '../../domain/Product';

export interface ProductFilter {
  /** Trecho do nome ou do SKU (sem diferenciar maiúsculas de minúsculas). */
  search?: string;
  /** Categoria exata (sem diferenciar maiúsculas de minúsculas). */
  category?: string;
  /** Restringe a uma lista de ids (usado pelo BFF para conferir os itens de um pedido). */
  ids?: string[];
  page: number;
  pageSize: number;
}

export interface ProductPage {
  items: Product[];
  /** Total de produtos que casam com o filtro (não só os da página). */
  total: number;
}

export interface ProductRepository {
  /** Lança SkuAlreadyExistsError se o SKU já estiver em uso. */
  insert(product: Product): Promise<void>;

  /**
   * Grava os dados cadastrais (tudo menos o estoque) e devolve o produto como ficou no banco,
   * ou null se ele não existir mais. Lança SkuAlreadyExistsError se o novo SKU já estiver em uso.
   */
  updateDetails(product: Product): Promise<Product | null>;

  findById(id: string): Promise<Product | null>;

  /** Ordenado por nome. */
  list(filter: ProductFilter): Promise<ProductPage>;

  /** Devolve false se o produto não existia. */
  delete(id: string): Promise<boolean>;
}
