import { Router } from 'express';
import { CreateProductHandler } from '../../../application/features/CreateProduct/CreateProduct';

export function mapCreateProduct(router: Router, handler: CreateProductHandler): void {
  router.post('/products', async (req, res) => {
    const product = await handler.execute(req.body);
    res.status(201).location(`/products/${product.id}`).json(product);
  });
}
