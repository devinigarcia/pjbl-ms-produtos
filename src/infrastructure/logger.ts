import pino, { Logger } from 'pino';

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    base: { service: 'ms-produtos' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // A chave interna nunca deve aparecer nos logs de requisição.
    redact: {
      paths: ['req.headers["x-api-key"]', 'req.headers.authorization', 'req.headers.cookie'],
      censor: '[oculto]',
    },
  });
}
