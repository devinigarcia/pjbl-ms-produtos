import { Router } from 'express';
import { ListStockMovementsHandler } from '../../../application/features/ListStockMovements/ListStockMovements';

export function mapListStockMovements(router: Router, handler: ListStockMovementsHandler): void {
  router.get('/products/:id/stock-movements', async (req, res) => {
    const result = await handler.execute(req.params.id, req.query);
    res.json(result);
  });
}
