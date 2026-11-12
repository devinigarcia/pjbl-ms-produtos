import { z } from 'zod';
import { ProductDto, toProductDto } from '../../dtos';
import { ProductRepository } from '../../ports/ProductRepository';
import { validate } from '../../validation';

export const LIST_PRODUCTS_LIMITS = { defaultPageSize: 20, maxPageSize: 100, maxIds: 100 } as const;

// Filtro de texto opcional: vazio conta como "não informado".
const optionalText = z
  .string({ invalid_type_error: 'Informe apenas um valor.' })
  .trim()
  .max(120, 'Deve ter no máximo 120 caracteres.')
  .optional()
  .transform((value) => (value ? value : undefined));

// ids chega como "a,b,c" na query string.
const idsField = z
  .string({ invalid_type_error: 'Informe os ids separados por vírgula.' })
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    const ids = [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];
    return ids.length > 0 ? ids : undefined;
  })
  .refine((ids) => !ids || ids.length <= LIST_PRODUCTS_LIMITS.maxIds, {
    message: `Informe no máximo ${LIST_PRODUCTS_LIMITS.maxIds} ids.`,
  });

export const listProductsSchema = z.object({
  search: optionalText,
  category: optionalText,
  ids: idsField,
  page: z.coerce
    .number({ invalid_type_error: 'A página deve ser um número inteiro.' })
    .int('A página deve ser um número inteiro.')
    .min(1, 'A página começa em 1.')
    .default(1),
  pageSize: z.coerce
    .number({ invalid_type_error: 'O tamanho da página deve ser um número inteiro.' })
    .int('O tamanho da página deve ser um número inteiro.')
    .min(1, 'O tamanho da página deve ser no mínimo 1.')
    .max(LIST_PRODUCTS_LIMITS.maxPageSize, `O tamanho máximo da página é ${LIST_PRODUCTS_LIMITS.maxPageSize}.`)
    .default(LIST_PRODUCTS_LIMITS.defaultPageSize),
});

export type ListProductsQuery = z.input<typeof listProductsSchema>;

export interface ListProductsResult {
  items: ProductDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListProductsDeps {
  products: ProductRepository;
}

export class ListProductsHandler {
  constructor(private readonly deps: ListProductsDeps) {}

  async execute(query: unknown = {}): Promise<ListProductsResult> {
    const filter = validate(listProductsSchema, query ?? {});
    const { items, total } = await this.deps.products.list(filter);

    return {
      items: items.map(toProductDto),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }
}
