import { Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { SignInFormPost } from '#/lib/account-input.ts'

const form = (fields: Record<string, string | Blob>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value)
  }
  return data
}
const decodePost = Schema.decodeUnknownExit(SignInFormPost)
const messagesOf = (input: unknown) => {
  const validation = Schema.toStandardSchemaV1(SignInFormPost)['~standard'].validate(input)
  if ('then' in validation) {
    throw new TypeError('SignInFormPost validates synchronously')
  }
  return validation.issues?.map((issue) => issue.message) ?? []
}

describe('SignInFormPost', () => {
  it('reads the fields of the login form, trimming the address like the script does', () => {
    const exit = decodePost(form({ email: ' ada@example.test ', password: ' secret ', redirect: '/account' }))
    expect(exit).toEqual(Exit.succeed({ email: 'ada@example.test', password: ' secret ', redirect: '/account' }))
  })

  it('treats a missing field or a file as empty, which the checks refuse', () => {
    const messages = messagesOf(form({ email: new Blob(['ada@example.test']), redirect: '' }))
    expect(messages).toContain('Enter your email address.')
    expect(messages).toContain('Enter your password.')
    expect(messagesOf(form({ email: 'ada@example.test', password: 'secret', redirect: '' }))).toEqual([])
  })

  it('refuses anything but FormData', () => {
    expect(Exit.isFailure(decodePost({ email: 'ada@example.test', password: 'secret', redirect: '' }))).toBe(true)
  })

  it('encodes back to the same form fields', () => {
    const fields = { email: 'ada@example.test', password: 'secret', redirect: '/' }
    const encoded = Schema.encodeSync(SignInFormPost)(fields)
    expect(Object.fromEntries(encoded)).toEqual(fields)
  })
})
