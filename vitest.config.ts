import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    // O primeiro teste de integração baixa o binário do mongod (mongodb-memory-server),
    // por isso os hooks têm um limite bem folgado.
    hookTimeout: 600_000,
  },
});
