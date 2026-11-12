import { Router } from 'express';
import { UpdateProductHandler } from '../../../application/features/UpdateProduct/UpdateProduct';

export function mapUpdateProduct(router: Router, handler: UpdateProductHandler): void {
  router.put('/products/:id', async (req, res) => {
    const product = await handler.execute(req.params.id, req.body);
    res.json(product);
  });
}
