import { decodeSync, toStandardSchemaV1 } from 'effect/Schema'
import type { ConstraintDecoder } from 'effect/Schema'

export const toFormSchema = <S extends ConstraintDecoder<unknown>>(schema: S) => ({
  decode: decodeSync(schema),
  validator: toStandardSchemaV1(schema),
})
