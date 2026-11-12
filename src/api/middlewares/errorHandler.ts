import { NextFunction, Request, Response } from 'express';
import { Logger } from 'pino';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../../domain/errors';
import { getCorrelationId } from './correlationId';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: readonly unknown[];
    correlationId: string;
  };
}

function body(res: Response, code: string, message: string, details?: readonly unknown[]): ErrorBody {
  return {
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
      correlationId: getCorrelationId(res),
    },
  };
}

function statusOf(error: DomainError): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 422; // regra de negócio
}

/** Erros que o próprio Express/body-parser gera (JSON quebrado, corpo grande demais...). */
function isHttpError(error: unknown): error is { type?: string; status?: number; statusCode?: number } {
  return typeof error === 'object' && error !== null && ('type' in error || 'status' in error);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(body(res, 'ROUTE_NOT_FOUND', `Rota ${req.method} ${req.path} não existe.`));
}

/** Converte qualquer erro no corpo padrão { error: { code, message, details?, correlationId } }. */
export function errorHandler(logger: Logger) {
  // O Express só reconhece o middleware de erro se ele declarar os 4 parâmetros.
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (error instanceof DomainError) {
      res.status(statusOf(error)).json(body(res, error.code, error.message, error.details));
      return;
    }

    if (isHttpError(error)) {
      if (error.type === 'entity.parse.failed') {
        res.status(400).json(body(res, 'INVALID_JSON', 'O corpo da requisição não é um JSON válido.'));
        return;
      }
      if (error.type === 'entity.too.large') {
        res.status(413).json(body(res, 'PAYLOAD_TOO_LARGE', 'O corpo da requisição é grande demais.'));
        return;
      }
      // demais erros 4xx do body-parser (charset não suportado, etc.)
      const status = error.status ?? error.statusCode;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        res.status(status).json(body(res, 'BAD_REQUEST', 'Requisição inválida.'));
        return;
      }
    }

    logger.error(
      { err: error, correlationId: getCorrelationId(res), method: req.method, path: req.path },
      'Erro inesperado ao processar a requisição',
    );
    res.status(500).json(body(res, 'INTERNAL_ERROR', 'Erro interno. Tente novamente em instantes.'));
  };
}
