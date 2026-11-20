import type { StandardSchemaV1 } from '@tanstack/react-form'
import type { Schema } from 'effect'
import { useState } from 'react'
import { focusFirstInvalid } from './field-messages.ts'

type FormSchema<Fields, Output> = {
  decode: (fields: Fields) => Output
  validator: StandardSchemaV1<Fields, Output>
}

export type LazyFormSchema<Fields, Output> = {
  readonly decode: (fields: Fields) => Output
  readonly load: () => Promise<void>
  readonly validator: StandardSchemaV1<Fields, Output>
}

const sharedRetryingLoad = (loadOnce: () => Promise<void>): (() => Promise<void>) => {
  let loading: Promise<void> | undefined
  return () =>
    (loading ??= loadOnce().catch((error: unknown) => {
      loading = undefined
      throw error
    }))
}

const loadFormSchema = async <S extends Schema.ConstraintDecoder<unknown>>(
  loadSchema: () => Promise<S>,
): Promise<FormSchema<S['Encoded'], S['Type']>> => {
  const [schema, toFormSchema] = await Promise.all([
    loadSchema(),
    import('./form-schema.ts').then((module) => module.toFormSchema),
  ])
  return toFormSchema(schema)
}

const deferredValidator = <Fields, Output>(
  ready: () => FormSchema<Fields, Output>,
): StandardSchemaV1<Fields, Output> => ({
  '~standard': {
    validate: (value) => ready().validator['~standard'].validate(value),
    vendor: 'effect',
    version: 1,
  },
})

export const lazyFormSchema = <S extends Schema.ConstraintDecoder<unknown>>(
  loadSchema: () => Promise<S>,
): LazyFormSchema<S['Encoded'], S['Type']> => {
  let loaded: FormSchema<S['Encoded'], S['Type']> | undefined
  const ready = () => {
    if (loaded) {
      return loaded
    }
    throw new Error('a form schema was used before it loaded: submit through submitForm, which awaits it')
  }
  const load = sharedRetryingLoad(async () => {
    loaded = await loadFormSchema(loadSchema)
  })
  return { decode: (fields) => ready().decode(fields), load, validator: deferredValidator(ready) }
}

type LoadableSchema = { load: () => Promise<void> }

const startLoading = (schema: LoadableSchema) => () => {
  schema.load().catch(() => {})
}

export const loadOnInteraction = (schema: LoadableSchema) => ({
  onFocus: startLoading(schema),
  onInput: startLoading(schema),
})

type SubmittableForm = { handleSubmit: () => Promise<void> }

const submitForm = async (form: SubmittableForm, schema?: LoadableSchema) => {
  const loaded = await (schema?.load() ?? Promise.resolve()).then(() => true).catch(() => false)
  if (!loaded) {
    return false
  }
  await form.handleSubmit()
  return true
}

const focusInvalidOnCommit = (onDone: () => void) => (element: HTMLFormElement | null) => {
  if (!element) {
    return
  }
  focusFirstInvalid(element)
  onDone()
}

export const SCHEMA_LOAD_FAILED = "Couldn't load the form. Check your connection and try again."

export const useSchemaSubmit = (form: SubmittableForm, schema?: LoadableSchema) => {
  const [loadFailed, setLoadFailed] = useState(false)
  const [pendingFocus, setPendingFocus] = useState(false)
  const run = async () => {
    const loaded = await submitForm(form, schema)
    setLoadFailed(!loaded)
    if (loaded) {
      setPendingFocus(true)
    }
  }
  const formRef = pendingFocus ? focusInvalidOnCommit(() => setPendingFocus(false)) : undefined
  return { formRef, schemaError: loadFailed ? SCHEMA_LOAD_FAILED : undefined, submit: () => void run() }
}
