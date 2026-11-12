import { createHash, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { getCorrelationId } from './correlationId';

export const API_KEY_HEADER = 'x-api-key';

function sameKey(received: string, expected: string): boolean {
  // Compara os hashes para ter sempre o mesmo tamanho e não vazar nada pelo tempo de resposta.
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Se INTERNAL_API_KEY estiver definida, só passa quem mandar o mesmo valor em x-api-key
 * (na prática: o BFF e a Azure Function). Sem a variável o serviço fica aberto, o que
 * é útil para rodar localmente. /health, /docs e /openapi.json são registrados antes deste
 * middleware no app.ts, por isso continuam públicos.
 */
export function apiKeyGuard(expectedKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // O preflight do CORS não carrega cabeçalhos personalizados.
    if (!expectedKey || req.method === 'OPTIONS') {
      next();
      return;
    }

    const received = req.header(API_KEY_HEADER);
    if (received && sameKey(received, expectedKey)) {
      next();
      return;
    }

    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Chave de acesso ausente ou inválida (cabeçalho x-api-key).',
        correlationId: getCorrelationId(res),
      },
    });
  };
}
