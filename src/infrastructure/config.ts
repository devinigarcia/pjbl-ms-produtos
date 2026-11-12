import { existsSync } from 'node:fs';

export type DbDriver = 'mongo' | 'memory';

export interface AppConfig {
  port: number;
  dbDriver: DbDriver;
  mongodbUri?: string;
  mongodbDb: string;
  /** Se definida, as rotas de negócio exigem o cabeçalho x-api-key com este valor. */
  internalApiKey?: string;
  /** "*" ou uma lista de origens separadas por vírgula. */
  corsOrigin: string;
  logLevel: string;
  /** URL pública do serviço (aparece em "servers" no Swagger). */
  publicUrl?: string;
}

/** Em desenvolvimento carrega o .env da raiz do projeto, se existir. Na nuvem as variáveis já vêm do ambiente. */
export function loadEnvFileIfPresent(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(optional(env.PORT) ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT inválida: "${env.PORT}".`);
  }

  const mongodbUri = optional(env.MONGODB_URI);

  // Sem DB_DRIVER explícito: usa o Mongo se houver URI, senão cai para memória (bom para demonstração local).
  const driver = (optional(env.DB_DRIVER) ?? (mongodbUri ? 'mongo' : 'memory')).toLowerCase();
  if (driver !== 'mongo' && driver !== 'memory') {
    throw new Error(`DB_DRIVER inválido: "${env.DB_DRIVER}". Use "mongo" ou "memory".`);
  }
  if (driver === 'mongo' && !mongodbUri) {
    throw new Error('DB_DRIVER=mongo exige a variável MONGODB_URI.');
  }

  return {
    port,
    dbDriver: driver,
    mongodbUri,
    mongodbDb: optional(env.MONGODB_DB) ?? 'pjbl_produtos',
    internalApiKey: optional(env.INTERNAL_API_KEY),
    corsOrigin: optional(env.CORS_ORIGIN) ?? '*',
    logLevel: optional(env.LOG_LEVEL) ?? 'info',
    publicUrl: optional(env.PUBLIC_URL)?.replace(/\/+$/, ''),
  };
}
