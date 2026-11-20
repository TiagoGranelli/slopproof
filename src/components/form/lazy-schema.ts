import type { StandardSchemaV1 } from '@tanstack/react-form'
import type { Schema } from 'effect'
import { useState } from 'react'
import { focusFirstInvalid } from './field-messages.ts'

type FormSchema<Fields, Output> = {
  decode: (fields: Fields) => Output
  validator: StandardSchemaV1<Fields, Output>
}

/**
 * A form's Effect Schema, loaded on the first interaction instead of with the page. The Schema runtime is about
 * 40 KB gzip, and preloading it kept the form pages' mobile Lighthouse score under 100. Nothing validates before
 * the first submit (`revalidateLogic()`), and `submitForm` awaits `load` first, so the schema is always there
 * when TanStack Form asks.
 */
export type LazyFormSchema<Fields, Output> = {
  /** The valid fields as the action takes them (for example, trimmed). Same rule as `validator`. */
  readonly decode: (fields: Fields) => Output
  /** Starts loading the schema, once; resolves when it is ready. A failed load is retried on the next call. */
  readonly load: () => Promise<void>
  /** For `validators.onDynamic`. Throws if it runs before `load` resolved: submit through `submitForm`. */
  readonly validator: StandardSchemaV1<Fields, Output>
}

/** `loadOnce` started at most once: callers share the pending load, and a failed one is retried on the next call. */
const sharedRetryingLoad = (loadOnce: () => Promise<void>): (() => Promise<void>) => {
  let loading: Promise<void> | undefined
  return () =>
    (loading ??= loadOnce().catch((error: unknown) => {
      loading = undefined
      throw error
    }))
}

/** The schema and the Standard Schema adapter (./form-schema.ts), loaded together as the form's validator. */
const loadFormSchema = async <S extends Schema.ConstraintDecoder<unknown>>(
  loadSchema: () => Promise<S>,
): Promise<FormSchema<S['Encoded'], S['Type']>> => {
  const [schema, toFormSchema] = await Promise.all([
    loadSchema(),
    import('./form-schema.ts').then((module) => module.toFormSchema),
  ])
  return toFormSchema(schema)
}

/** A Standard Schema validator that hands each value to the loaded schema's validator. */
const deferredValidator = <Fields, Output>(
  ready: () => FormSchema<Fields, Output>,
): StandardSchemaV1<Fields, Output> => ({
  '~standard': {
    validate: (value) => ready().validator['~standard'].validate(value),
    vendor: 'effect',
    version: 1,
  },
})

/**
 * Wraps `loadSchema`, a dynamic import that resolves to the form's schema (the same one the server validates
 * with), for example `() => import('#/lib/account-input.ts').then((m) => m.SignInInput)`.
 */
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
  // A failed load here is only an early start; the submit loads again and reports its own failure.
  schema.load().catch(() => {})
}

/** Props for the `<form>`: its first focus or input starts loading `schema`. */
export const loadOnInteraction = (schema: LoadableSchema) => ({
  onFocus: startLoading(schema),
  onInput: startLoading(schema),
})

type SubmittableForm = { handleSubmit: () => Promise<void> }

/**
 * Submits a TanStack form once its schema has loaded (a submit may come before the chunk arrives). Resolves
 * false, without submitting, when the schema could not be loaded.
 */
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

/** What a form says when its schema could not be loaded, for example a chunk request lost on a bad connection. */
const SCHEMA_LOAD_FAILED = "Couldn't load the form. Check your connection and try again."

/**
 * The submit of a form with a lazy schema. `submit()` loads the schema, then submits; attach `formRef` to the
 * `<form>` so focus moves to the first invalid field once React commits the validation state. If the schema
 * cannot be loaded, `schemaError` holds SCHEMA_LOAD_FAILED for the form to show in an alert, and the form stays
 * usable: the next submit loads again and clears it.
 */
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
