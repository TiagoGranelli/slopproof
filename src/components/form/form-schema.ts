import { Schema } from 'effect'

export const toFormSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => ({
  decode: Schema.decodeSync(schema),
  validator: Schema.toStandardSchemaV1(schema),
})
