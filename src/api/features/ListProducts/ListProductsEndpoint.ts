import { Router } from 'express';
import { ListProductsHandler } from '../../../application/features/ListProducts/ListProducts';

export function mapListProducts(router: Router, handler: ListProductsHandler): void {
  router.get('/products', async (req, res) => {
    const page = await handler.execute(req.query);
    res.json(page);
  });
}
