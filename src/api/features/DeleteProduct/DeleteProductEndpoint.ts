import { Router } from 'express';
import { DeleteProductHandler } from '../../../application/features/DeleteProduct/DeleteProduct';

export function mapDeleteProduct(router: Router, handler: DeleteProductHandler): void {
  router.delete('/products/:id', async (req, res) => {
    await handler.execute(req.params.id);
    res.status(204).end();
  });
}
