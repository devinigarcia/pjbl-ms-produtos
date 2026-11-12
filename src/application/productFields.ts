import { z } from 'zod';
import { PRODUCT_LIMITS, SKU_PATTERN, roundMoney } from '../domain/Product';

// Campos de produto reaproveitados pelos schemas de CreateProduct e UpdateProduct.
// Ficam fora das pastas de feature justamente para uma feature não precisar importar a outra.

export const skuField = z
  .string({ required_error: 'Informe o SKU.', invalid_type_error: 'O SKU deve ser um texto.' })
  .trim()
  .toUpperCase()
  .regex(
    SKU_PATTERN,
    'SKU inválido: use de 3 a 30 caracteres (letras, números e hífen), começando por letra ou número.',
  );

export const nameField = z
  .string({ required_error: 'Informe o nome.', invalid_type_error: 'O nome deve ser um texto.' })
  .trim()
  .min(PRODUCT_LIMITS.nameMin, `O nome deve ter no mínimo ${PRODUCT_LIMITS.nameMin} caracteres.`)
  .max(PRODUCT_LIMITS.nameMax, `O nome deve ter no máximo ${PRODUCT_LIMITS.nameMax} caracteres.`);

export const descriptionField = z
  .string({ invalid_type_error: 'A descrição deve ser um texto.' })
  .trim()
  .max(PRODUCT_LIMITS.descriptionMax, `A descrição deve ter no máximo ${PRODUCT_LIMITS.descriptionMax} caracteres.`);

export const categoryField = z
  .string({ required_error: 'Informe a categoria.', invalid_type_error: 'A categoria deve ser um texto.' })
  .trim()
  .min(PRODUCT_LIMITS.categoryMin, `A categoria deve ter no mínimo ${PRODUCT_LIMITS.categoryMin} caracteres.`)
  .max(PRODUCT_LIMITS.categoryMax, `A categoria deve ter no máximo ${PRODUCT_LIMITS.categoryMax} caracteres.`);

// O preço é arredondado para 2 casas antes de conferir se é maior que zero (0.004 vira 0 e é recusado).
export const priceField = z
  .number({ required_error: 'Informe o preço.', invalid_type_error: 'O preço deve ser um número.' })
  .finite('O preço deve ser um número válido.')
  .max(PRODUCT_LIMITS.priceMax, `O preço máximo é ${PRODUCT_LIMITS.priceMax}.`)
  .transform(roundMoney)
  .refine((value) => value > 0, 'Deve ser maior que zero.');

export const initialStockField = z
  .number({ invalid_type_error: 'O estoque deve ser um número inteiro.' })
  .int('O estoque deve ser um número inteiro.')
  .min(0, 'O estoque não pode ser negativo.')
  .max(PRODUCT_LIMITS.stockMax, `O estoque máximo é ${PRODUCT_LIMITS.stockMax}.`);
