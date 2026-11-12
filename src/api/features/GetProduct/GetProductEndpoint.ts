import { Router } from 'express';
import { GetProductHandler } from '../../../application/features/GetProduct/GetProduct';

export function mapGetProduct(router: Router, handler: GetProductHandler): void {
  router.get('/products/:id', async (req, res) => {
    const product = await handler.execute(req.params.id);
    res.json(product);
  });
}
