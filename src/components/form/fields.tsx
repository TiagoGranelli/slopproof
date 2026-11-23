import { use } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { FieldError } from './field-error.tsx'
import { describedBy, fieldErrorMessage } from './field-messages.ts'
import { useFieldContext } from './form-context.ts'
import { ServerIssues } from './server-issues.ts'

type InputProps = Omit<ComponentProps<'input'>, 'name' | 'value' | 'checked' | 'onChange' | 'onBlur'>

export function TextField({ hint, id, label, ...input }: InputProps & { hint?: string; id: string; label: string }) {
  const field = useFieldContext<string>()
  const serverIssue = use(ServerIssues)[field.name]
  const error = fieldErrorMessage(field.state.meta.errors) ?? serverIssue
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = `${id}-error`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...input}
        aria-describedby={describedBy(hintId, error && errorId)}
        aria-invalid={error ? true : undefined}
        id={id}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        value={field.state.value}
      />
      {hint ? (
        <p className="text-xs text-muted-foreground" id={hintId}>
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

export function CheckboxField({ id, label, ...input }: InputProps & { id: string; label: ReactNode }) {
  const field = useFieldContext<boolean>()
  const error = fieldErrorMessage(field.state.meta.errors)
  const errorId = `${id}-error`
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-2 text-sm">
        <input
          {...input}
          aria-describedby={describedBy(error && errorId)}
          aria-invalid={error ? true : undefined}
          checked={field.state.value}
          id={id}
          name={field.name}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.checked)}
          type="checkbox"
        />
        <label htmlFor={id}>{label}</label>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  )
}
