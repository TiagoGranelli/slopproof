// Model-based browser property test (`fc.commands` / `fc.asyncModelRun`) driving the rendered LoginForm.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LoginForm } from '#/features/auth/components/login-form.tsx'
import { authCalls, authFunction, worker } from './api-mocks.ts'
import { formOf, renderInApp } from './test-utils.tsx'

interface RenderedAuthModel {
  alertVisible: boolean
  requestsSent: number
  succeeded: boolean
}

interface RenderedAuthReal {
  calls: ReturnType<typeof authCalls>
  router: Awaited<ReturnType<typeof renderInApp>>['router']
}

const emailField = () => page.getByLabelText('Email')
const passwordField = () => page.getByLabelText('Password')
const submitButton = () => page.getByRole('button', { name: 'Sign in' })

const runInvalidSubmit = async (model: RenderedAuthModel, real: RenderedAuthReal) => {
  await emailField().fill('not-an-email')
  await passwordField().fill('short')
  await submitButton().click()
  await expect.element(emailField()).toHaveAttribute('aria-invalid', 'true')
  await expect.element(emailField()).toHaveFocus()
  expect(real.calls.data).toHaveLength(model.requestsSent)
  model.alertVisible = false
}

const runFailedSubmit = async (model: RenderedAuthModel, real: RenderedAuthReal) => {
  worker.use(real.calls.handler, authFunction('signIn', { failure: { code: 'INVALID_EMAIL_OR_PASSWORD' }, ok: false }))
  await emailField().fill('author@example.test')
  await passwordField().fill('a valid length password')
  await submitButton().click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('Wrong email or password.')
  await expect.element(submitButton()).toHaveFocus()
  await expect.element(formOf(submitButton())).toHaveAttribute('aria-busy', 'false')
  model.requestsSent++
  expect(real.calls.data).toHaveLength(model.requestsSent)
  model.alertVisible = true
}

const runSucceededSubmit = async (model: RenderedAuthModel, real: RenderedAuthReal) => {
  worker.use(real.calls.handler, authFunction('signIn', { ok: true, value: null }))
  await emailField().fill('author@example.test')
  await passwordField().fill('a valid length password')
  await submitButton().click()
  await expect.poll(() => real.router.state.location.href).toBe('/dashboard')
  model.requestsSent++
  expect(real.calls.data).toHaveLength(model.requestsSent)
  model.succeeded = true
  model.alertVisible = false
}

const invalidSubmitCommand: fc.AsyncCommand<RenderedAuthModel, RenderedAuthReal> = {
  check: (model) => !model.succeeded,
  run: (model, real) => runInvalidSubmit(model, real),
  toString: () => 'submit(invalid)',
}

const failedSubmitCommand: fc.AsyncCommand<RenderedAuthModel, RenderedAuthReal> = {
  check: (model) => !model.succeeded,
  run: (model, real) => runFailedSubmit(model, real),
  toString: () => 'submit(server-error)',
}

const succeededSubmitCommand: fc.AsyncCommand<RenderedAuthModel, RenderedAuthReal> = {
  check: (model) => !model.succeeded,
  run: (model, real) => runSucceededSubmit(model, real),
  toString: () => 'submit(succeed)',
}

const authCommands = fc.commands(
  [fc.constant(invalidSubmitCommand), fc.constant(failedSubmitCommand), fc.constant(succeededSubmitCommand)],
  { maxCommands: 5 },
)

describe('AuthForm property-based UI invariants', () => {
  it('enforces validation focus, error clearing and single-submit invariants across random attempts', async () => {
    await fc.assert(
      fc.asyncProperty(authCommands, async (commands) => {
        const calls = authCalls('signIn')
        worker.use(calls.handler)
        const rendered = await renderInApp(<LoginForm />, { url: '/login' })
        const model: RenderedAuthModel = { alertVisible: false, requestsSent: 0, succeeded: false }
        const real: RenderedAuthReal = { calls, router: rendered.router }
        await fc.asyncModelRun(() => ({ model, real }), commands)
        expect(calls.data).toHaveLength(model.requestsSent)
        await rendered.unmount()
      }),
      { numRuns: 5 },
    )
  })
})
