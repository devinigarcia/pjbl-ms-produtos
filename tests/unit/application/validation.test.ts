import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../../../src/application/validation';
import { ValidationError } from '../../../src/domain/errors';

const schema = z.object({
  name: z.string().min(2),
  age: z.number().int().min(18),
  role: z.enum(['ADMIN', 'USER']),
});

function issuesOf(input: unknown) {
  try {
    validate(schema, input);
  } catch (error) {
    if (error instanceof ValidationError) return error.issues;
    throw error;
  }
  throw new Error('Era esperado um ValidationError.');
}

describe('validate (application)', () => {
  it('devolve os dados já convertidos quando está tudo certo', () => {
    expect(validate(schema, { name: 'Ana', age: 20, role: 'USER', extra: true })).toEqual({
      name: 'Ana',
      age: 20,
      role: 'USER',
    });
  });

  it('lança ValidationError com código, mensagem e a lista { field, message } em português', () => {
    const issues = issuesOf({ name: 'A', age: 18.5, role: 'ROOT' });

    expect(issues).toEqual([
      { field: 'name', message: 'Deve ter no mínimo 2 caractere(s).' },
      { field: 'age', message: 'Tipo inválido: esperado número inteiro.' },
      { field: 'role', message: 'Valor inválido. Use: ADMIN, USER.' },
    ]);

    const error = new ValidationError(issues);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Dados inválidos.');
  });

  it('marca campos ausentes como obrigatórios e usa "body" quando o problema é o corpo inteiro', () => {
    expect(issuesOf({})).toEqual([
      { field: 'name', message: 'Campo obrigatório.' },
      { field: 'age', message: 'Campo obrigatório.' },
      { field: 'role', message: 'Campo obrigatório.' },
    ]);
    expect(issuesOf(undefined)).toEqual([{ field: 'body', message: 'Campo obrigatório.' }]);
  });
});
