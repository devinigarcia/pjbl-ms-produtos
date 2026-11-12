import { z, ZodErrorMap, ZodIssueCode, ZodTypeAny } from 'zod';
import { FieldIssue, ValidationError } from '../domain/errors';

const typeNames: Record<string, string> = {
  string: 'texto',
  number: 'número',
  integer: 'número inteiro',
  boolean: 'verdadeiro/falso',
  object: 'objeto',
  array: 'lista',
};

/**
 * Mensagens padrão do zod em português. Os schemas das features definem mensagens
 * próprias na maioria dos casos; isto aqui cobre o que escapar.
 */
const ptBrErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Campo obrigatório.' };
      }
      return { message: `Tipo inválido: esperado ${typeNames[issue.expected] ?? issue.expected}.` };
    case ZodIssueCode.invalid_enum_value:
      return { message: `Valor inválido. Use: ${issue.options.join(', ')}.` };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: `Deve ter no mínimo ${issue.minimum} caractere(s).` };
      if (issue.type === 'array') return { message: `Deve ter no mínimo ${issue.minimum} item(ns).` };
      return { message: `Deve ser maior ${issue.inclusive ? 'ou igual a' : 'que'} ${issue.minimum}.` };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Deve ter no máximo ${issue.maximum} caractere(s).` };
      if (issue.type === 'array') return { message: `Deve ter no máximo ${issue.maximum} item(ns).` };
      return { message: `Deve ser menor ${issue.inclusive ? 'ou igual a' : 'que'} ${issue.maximum}.` };
    case ZodIssueCode.invalid_string:
      return { message: 'Formato inválido.' };
    case ZodIssueCode.not_finite:
      return { message: 'Deve ser um número válido.' };
    default:
      return { message: ctx.defaultError };
  }
};

// Registrado como mapa global (e não por chamada) porque no zod 3 o mapa passado no parse
// teria prioridade sobre o required_error/invalid_type_error definidos em cada schema.
z.setErrorMap(ptBrErrorMap);

function toFieldIssue(issue: z.ZodIssue): FieldIssue {
  return {
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  };
}

/**
 * Valida a entrada de um caso de uso. Se algo estiver errado lança ValidationError
 * com a lista { field, message } que a API devolve em "details".
 */
export function validate<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(result.error.issues.map(toFieldIssue));
}
