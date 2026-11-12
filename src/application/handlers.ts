import { CreateProductHandler } from './features/CreateProduct/CreateProduct';
import { DeleteProductHandler } from './features/DeleteProduct/DeleteProduct';
import { GetProductHandler } from './features/GetProduct/GetProduct';
import { ListProductsHandler } from './features/ListProducts/ListProducts';
import { ListStockMovementsHandler } from './features/ListStockMovements/ListStockMovements';
import { RegisterStockMovementHandler } from './features/RegisterStockMovement/RegisterStockMovement';
import { UpdateProductHandler } from './features/UpdateProduct/UpdateProduct';
import { ProductRepository } from './ports/ProductRepository';
import { StockMovementRepository } from './ports/StockMovementRepository';

export interface Handlers {
  createProduct: CreateProductHandler;
  listProducts: ListProductsHandler;
  getProduct: GetProductHandler;
  updateProduct: UpdateProductHandler;
  deleteProduct: DeleteProductHandler;
  registerStockMovement: RegisterStockMovementHandler;
  listStockMovements: ListStockMovementsHandler;
}

export interface HandlerDependencies {
  products: ProductRepository;
  movements: StockMovementRepository;
  /** Relógio injetável (os testes usam um relógio fixo). */
  now?: () => Date;
}

/** Monta um handler por feature em cima das portas. Quem escolhe Mongo ou memória é o main.ts. */
export function createHandlers(deps: HandlerDependencies): Handlers {
  return {
    createProduct: new CreateProductHandler(deps),
    listProducts: new ListProductsHandler(deps),
    getProduct: new GetProductHandler(deps),
    updateProduct: new UpdateProductHandler(deps),
    deleteProduct: new DeleteProductHandler(deps),
    registerStockMovement: new RegisterStockMovementHandler(deps),
    listStockMovements: new ListStockMovementsHandler(deps),
  };
}
