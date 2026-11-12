import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

// Aceita só valores "bem comportados" para não jogar qualquer coisa nos logs e na resposta.
const SAFE_VALUE = /^[\w.:-]{1,128}$/;

/**
 * Reaproveita o x-correlation-id que veio na requisição (BFF, Function...) ou gera um novo.
 * O valor volta sempre no cabeçalho da resposta e aparece nos logs e nos erros.
 */
export function correlationId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const received = req.header(CORRELATION_HEADER)?.trim();
    const id = received && SAFE_VALUE.test(received) ? received : randomUUID();

    res.locals.correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);
    next();
  };
}

export function getCorrelationId(res: Response): string {
  return String(res.locals.correlationId ?? '');
}
