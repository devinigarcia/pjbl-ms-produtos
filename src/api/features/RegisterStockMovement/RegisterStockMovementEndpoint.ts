import { Router } from 'express';
import { RegisterStockMovementHandler } from '../../../application/features/RegisterStockMovement/RegisterStockMovement';

export function mapRegisterStockMovement(router: Router, handler: RegisterStockMovementHandler): void {
  router.post('/products/:id/stock-movements', async (req, res) => {
    const result = await handler.execute(req.params.id, req.body);
    // 201 quando a movimentação foi aplicada agora; 200 quando o eventId já tinha sido aplicado.
    res.status(result.duplicate ? 200 : 201).json(result);
  });
}
