import { FieldIssue, InsufficientStockError, ValidationError } from './errors';
import { StockMovementType, stockDelta } from './StockMovement';

/** SKU sempre em maiúsculo: letras, números e hífen, de 3 a 30 caracteres. */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,29}$/;

/** Com este saldo ou menos o produto é sinalizado como "estoque baixo". */
export const LOW_STOCK_THRESHOLD = 5;

export const PRODUCT_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  descriptionMax: 1000,
  categoryMin: 2,
  categoryMax: 60,
  priceMax: 9_999_999.99,
  stockMax: 1_000_000,
} as const;

export interface ProductProps {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProductInput {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category: string;
  price: number;
  /** Estoque inicial (padrão 0). Depois do cadastro o estoque só muda por movimentação. */
  stock?: number;
  now: Date;
}

export interface ProductChanges {
  sku?: string;
  name: string;
  description?: string;
  category: string;
  price: number;
}

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * Arredonda para 2 casas (centavos). O toPrecision limpa a sujeira de ponto flutuante
 * antes de arredondar: 10.005 * 100 dá 1000.4999999999999 e, sem isso, viraria 10.00.
 */
export function roundMoney(value: number): number {
  return Math.round(Number((value * 100).toPrecision(15))) / 100;
}

export class Product {
  private constructor(private props: ProductProps) {}

  static create(input: NewProductInput): Product {
    const props: ProductProps = {
      id: input.id,
      sku: normalizeSku(input.sku),
      name: input.name.trim(),
      description: (input.description ?? '').trim(),
      category: input.category.trim(),
      price: roundMoney(input.price),
      stock: input.stock ?? 0,
      createdAt: input.now,
      updatedAt: input.now,
    };
    assertValid(props);
    return new Product(props);
  }

  /** Remonta um produto que já foi validado e salvo (vindo do banco). */
  static restore(props: ProductProps): Product {
    return new Product({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get sku(): string {
    return this.props.sku;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
  }
  get category(): string {
    return this.props.category;
  }
  get price(): number {
    return this.props.price;
  }
  get stock(): number {
    return this.props.stock;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get lowStock(): boolean {
    return this.props.stock <= LOW_STOCK_THRESHOLD;
  }

  /**
   * Atualiza os dados cadastrais. De propósito não existe "stock" aqui:
   * estoque só muda por movimentação, para o histórico sempre fechar com o saldo.
   */
  update(changes: ProductChanges, now: Date): void {
    const next: ProductProps = {
      ...this.props,
      sku: changes.sku === undefined ? this.props.sku : normalizeSku(changes.sku),
      name: changes.name.trim(),
      description: changes.description === undefined ? this.props.description : changes.description.trim(),
      category: changes.category.trim(),
      price: roundMoney(changes.price),
      updatedAt: now,
    };
    assertValid(next);
    this.props = next;
  }

  /** Aplica uma entrada ou saída e devolve o novo saldo. Saída maior que o saldo é recusada. */
  applyMovement(type: StockMovementType, quantity: number, now: Date): number {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError([
        { field: 'quantity', message: 'A quantidade deve ser um número inteiro maior que zero.' },
      ]);
    }
    const balance = this.props.stock + stockDelta(type, quantity);
    if (balance < 0) {
      throw new InsufficientStockError({
        productId: this.props.id,
        productName: this.props.name,
        requested: quantity,
        available: this.props.stock,
      });
    }
    this.props = { ...this.props, stock: balance, updatedAt: now };
    return balance;
  }

  toProps(): ProductProps {
    return { ...this.props };
  }
}

function assertValid(props: ProductProps): void {
  const issues: FieldIssue[] = [];

  if (!SKU_PATTERN.test(props.sku)) {
    issues.push({
      field: 'sku',
      message: 'SKU inválido: use de 3 a 30 caracteres (letras, números e hífen), começando por letra ou número.',
    });
  }
  if (props.name.length < PRODUCT_LIMITS.nameMin || props.name.length > PRODUCT_LIMITS.nameMax) {
    issues.push({
      field: 'name',
      message: `O nome deve ter entre ${PRODUCT_LIMITS.nameMin} e ${PRODUCT_LIMITS.nameMax} caracteres.`,
    });
  }
  if (props.description.length > PRODUCT_LIMITS.descriptionMax) {
    issues.push({
      field: 'description',
      message: `A descrição pode ter no máximo ${PRODUCT_LIMITS.descriptionMax} caracteres.`,
    });
  }
  if (props.category.length < PRODUCT_LIMITS.categoryMin || props.category.length > PRODUCT_LIMITS.categoryMax) {
    issues.push({
      field: 'category',
      message: `A categoria deve ter entre ${PRODUCT_LIMITS.categoryMin} e ${PRODUCT_LIMITS.categoryMax} caracteres.`,
    });
  }
  if (!Number.isFinite(props.price) || props.price <= 0) {
    issues.push({ field: 'price', message: 'Deve ser maior que zero.' });
  } else if (props.price > PRODUCT_LIMITS.priceMax) {
    issues.push({ field: 'price', message: `O preço máximo é ${PRODUCT_LIMITS.priceMax}.` });
  }
  if (!Number.isInteger(props.stock) || props.stock < 0) {
    issues.push({ field: 'stock', message: 'O estoque deve ser um número inteiro maior ou igual a zero.' });
  } else if (props.stock > PRODUCT_LIMITS.stockMax) {
    issues.push({ field: 'stock', message: `O estoque máximo é ${PRODUCT_LIMITS.stockMax}.` });
  }

  if (issues.length > 0) throw new ValidationError(issues);
}
