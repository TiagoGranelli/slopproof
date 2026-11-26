import {
  Boolean as SchemaBoolean,
  decodeTo,
  instanceOf,
  isMaxLength,
  isMinLength,
  isPattern,
  makeFilter,
  String as SchemaString,
  Struct,
} from 'effect/Schema'
import type { Check } from 'effect/SchemaAST'
import { transform, trim } from 'effect/SchemaTransformation'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { isFreeOfNul } from '#/contract/stored-text.ts'

const trimmed = (...checks: [Check<string>, ...Array<Check<string>>]) =>
  SchemaString.pipe(decodeTo(SchemaString.check(...checks), trim()))

const INVALID_EMAIL = 'Enter a valid email address.'
const Email = trimmed(
  isFreeOfNul,
  isMinLength(1, { message: 'Enter your email address.' }),
  isMaxLength(254, { message: INVALID_EMAIL }),
  isPattern(/^[^\s@]+@[^\s@]+$/, { message: INVALID_EMAIL }),
)

const CurrentPassword = SchemaString.check(
  isMinLength(1, { message: 'Enter your password.' }),
  isMaxLength(PASSWORD_MAX_LENGTH, { message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` }),
)

const NewPassword = SchemaString.check(
  isMinLength(PASSWORD_MIN_LENGTH, { message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` }),
  isMaxLength(PASSWORD_MAX_LENGTH, { message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` }),
)

const Name = trimmed(
  isFreeOfNul,
  isMinLength(1, { message: 'Enter your name.' }),
  isMaxLength(100, { message: 'Use at most 100 characters.' }),
)

const Token = SchemaString.check(isFreeOfNul, isMinLength(1), isMaxLength(2048))

export const SignInInput = Struct({ email: Email, password: CurrentPassword })

const textOf = (form: FormData, name: string) => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

export const SignInFormPost = instanceOf(FormData).pipe(
  decodeTo(
    Struct({ email: Email, password: CurrentPassword, redirect: SchemaString }),
    transform({
      decode: (form: FormData) => ({
        email: textOf(form, 'email'),
        password: textOf(form, 'password'),
        redirect: textOf(form, 'redirect'),
      }),
      encode: (fields) => {
        const form = new FormData()
        for (const [name, value] of Object.entries(fields)) {
          form.set(name, value)
        }
        return form
      },
    }),
  ),
)
export const SignUpInput = Struct({ email: Email, name: Name, password: NewPassword })
export const EmailInput = Struct({ email: Email })
export const TokenInput = Struct({ token: Token })
export const SessionInput = Struct({ id: Token })
export const NewPasswordInput = Struct({ newPassword: NewPassword })
export const ResetPasswordInput = Struct({ newPassword: NewPassword, token: Token })
export const ChangePasswordInput = Struct({ currentPassword: CurrentPassword, newPassword: NewPassword })
export const DeleteAccountInput = Struct({ password: CurrentPassword })
export const DeleteAccountFields = Struct({
  confirm: SchemaBoolean.check(
    makeFilter((checked: boolean) => checked, { message: 'Confirm that you want to delete the account.' }),
  ),
  password: CurrentPassword,
})
