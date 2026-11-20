import { createFormHook } from '@tanstack/react-form'
import { CheckboxField, TextField } from './fields.tsx'
import { fieldContext, formContext } from './form-context.ts'

export const { useAppForm } = createFormHook({
  fieldComponents: { CheckboxField, TextField },
  fieldContext,
  formComponents: {},
  formContext,
})
