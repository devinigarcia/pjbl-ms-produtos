// Erros do domínio. A camada de API traduz cada tipo para um status HTTP:
// ValidationError -> 400, NotFoundError -> 404, ConflictError -> 409 e DomainError "puro" -> 422.

export interface FieldIssue {
  field: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: string;
  readonly details?: readonly unknown[];

  constructor(code: string, message: string, details?: readonly unknown[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Dados de entrada fora do formato esperado (campo a campo). */
export class ValidationError extends DomainError {
  constructor(issues: readonly FieldIssue[], message = 'Dados inválidos.') {
    super('VALIDATION_ERROR', message, issues);
  }

  get issues(): readonly FieldIssue[] {
    return (this.details ?? []) as readonly FieldIssue[];
  }
}

export class NotFoundError extends DomainError {}

export class ConflictError extends DomainError {}

export class ProductNotFoundError extends NotFoundError {
  constructor(productId: string) {
    super('PRODUCT_NOT_FOUND', `Produto ${productId} não encontrado.`);
  }
}

export class SkuAlreadyExistsError extends ConflictError {
  constructor(sku: string) {
    super('SKU_ALREADY_EXISTS', `Já existe um produto com o SKU ${sku}.`, [{ field: 'sku', value: sku }]);
  }
}

export interface InsufficientStockInfo {
  productId: string;
  productName: string;
  requested: number;
  available: number;
}

export class InsufficientStockError extends ConflictError {
  constructor(info: InsufficientStockInfo) {
    super(
      'INSUFFICIENT_STOCK',
      `Estoque insuficiente para "${info.productName}": pedido ${info.requested}, disponível ${info.available}.`,
      [info],
    );
  }
}

/** O mesmo eventId já foi usado na movimentação de outro produto. */
export class EventIdAlreadyUsedError extends ConflictError {
  constructor(eventId: string) {
    super('EVENT_ID_ALREADY_USED', `O eventId ${eventId} já foi usado em uma movimentação de outro produto.`);
  }
}
