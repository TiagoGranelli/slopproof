import { Schema, SchemaTransformation } from 'effect'
import type { SchemaAST } from 'effect'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { isFreeOfNul } from '#/contract/stored-text.ts'

const trimmed = (...checks: [SchemaAST.Check<string>, ...Array<SchemaAST.Check<string>>]) =>
  Schema.String.pipe(Schema.decodeTo(Schema.String.check(...checks), SchemaTransformation.trim()))

const INVALID_EMAIL = 'Enter a valid email address.'
const Email = trimmed(
  isFreeOfNul,
  Schema.isMinLength(1, { message: 'Enter your email address.' }),
  Schema.isMaxLength(254, { message: INVALID_EMAIL }),
  Schema.isPattern(/^[^\s@]+@[^\s@]+$/, { message: INVALID_EMAIL }),
)

const CurrentPassword = Schema.String.check(
  Schema.isMinLength(1, { message: 'Enter your password.' }),
  Schema.isMaxLength(PASSWORD_MAX_LENGTH, { message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` }),
)

const NewPassword = Schema.String.check(
  Schema.isMinLength(PASSWORD_MIN_LENGTH, { message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` }),
  Schema.isMaxLength(PASSWORD_MAX_LENGTH, { message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` }),
)

const Name = trimmed(
  isFreeOfNul,
  Schema.isMinLength(1, { message: 'Enter your name.' }),
  Schema.isMaxLength(100, { message: 'Use at most 100 characters.' }),
)

const Token = Schema.String.check(isFreeOfNul, Schema.isMinLength(1), Schema.isMaxLength(2048))

export const SignInInput = Schema.Struct({ email: Email, password: CurrentPassword })

const textOf = (form: FormData, name: string) => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

export const SignInFormPost = Schema.instanceOf(FormData).pipe(
  Schema.decodeTo(
    Schema.Struct({ email: Email, password: CurrentPassword, redirect: Schema.String }),
    SchemaTransformation.transform({
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
export const SignUpInput = Schema.Struct({ email: Email, name: Name, password: NewPassword })
export const EmailInput = Schema.Struct({ email: Email })
export const TokenInput = Schema.Struct({ token: Token })
export const SessionInput = Schema.Struct({ id: Token })
export const NewPasswordInput = Schema.Struct({ newPassword: NewPassword })
export const ResetPasswordInput = Schema.Struct({ newPassword: NewPassword, token: Token })
export const ChangePasswordInput = Schema.Struct({ currentPassword: CurrentPassword, newPassword: NewPassword })
export const DeleteAccountInput = Schema.Struct({ password: CurrentPassword })
export const DeleteAccountFields = Schema.Struct({
  confirm: Schema.Boolean.check(
    Schema.makeFilter((checked: boolean) => checked, { message: 'Confirm that you want to delete the account.' }),
  ),
  password: CurrentPassword,
})
