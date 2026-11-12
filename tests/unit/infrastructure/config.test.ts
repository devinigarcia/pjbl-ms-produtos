import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/infrastructure/config';

describe('loadConfig', () => {
  it('sem nenhuma variável sobe na porta 3001 com repositório em memória e sem exigir chave', () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      dbDriver: 'memory',
      mongodbUri: undefined,
      mongodbDb: 'pjbl_produtos',
      internalApiKey: undefined,
      corsOrigin: '*',
      logLevel: 'info',
      publicUrl: undefined,
    });
  });

  it('usa o MongoDB quando MONGODB_URI está definida', () => {
    const config = loadConfig({
      PORT: '8080',
      MONGODB_URI: 'mongodb://localhost:27017',
      MONGODB_DB: 'loja',
      INTERNAL_API_KEY: ' chave-de-teste ',
      CORS_ORIGIN: 'https://app.exemplo.com',
      LOG_LEVEL: 'debug',
      PUBLIC_URL: 'https://ms-produtos.exemplo.com/',
    });

    expect(config).toMatchObject({
      port: 8080,
      dbDriver: 'mongo',
      mongodbDb: 'loja',
      internalApiKey: 'chave-de-teste',
      corsOrigin: 'https://app.exemplo.com',
      logLevel: 'debug',
      publicUrl: 'https://ms-produtos.exemplo.com',
    });
  });

  it('DB_DRIVER=memory vence mesmo com URI definida', () => {
    expect(loadConfig({ DB_DRIVER: 'memory', MONGODB_URI: 'mongodb://localhost:27017' }).dbDriver).toBe('memory');
  });

  it('falha logo na subida se a configuração estiver errada', () => {
    expect(() => loadConfig({ DB_DRIVER: 'mongo' })).toThrow(/MONGODB_URI/);
    expect(() => loadConfig({ DB_DRIVER: 'postgres' })).toThrow(/DB_DRIVER/);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
