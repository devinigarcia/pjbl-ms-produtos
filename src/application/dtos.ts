import { Product } from '../domain/Product';
import { StockMovement, StockMovementType } from '../domain/StockMovement';

// Formato JSON devolvido pela API (o mesmo descrito em docs/contratos.md do repositório pjbl-arquitetura).

export interface ProductDto {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementDto {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  eventId: string | null;
  balanceAfter: number;
  createdAt: string;
}

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    stock: product.stock,
    lowStock: product.lowStock,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toStockMovementDto(movement: StockMovement): StockMovementDto {
  return {
    id: movement.id,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantity,
    reason: movement.reason,
    eventId: movement.eventId,
    balanceAfter: movement.balanceAfter,
    createdAt: movement.createdAt.toISOString(),
  };
}
