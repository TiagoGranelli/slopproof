// Auth form state machine: explicit examples plus fast-check model-based command sequences (`fc.commands` / `fc.modelRun`).
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import {
  type AuthFormEvent,
  type AuthFormState,
  initialAuthFormState,
  isAuthFormBusy,
  transitionAuthForm,
} from '#/features/auth/utils/auth-form-machine.ts'
import type { AuthFieldCodes } from '#/features/auth/utils/describe-auth-failure.ts'

const FIELD_CODES: AuthFieldCodes = {
  INVALID_EMAIL: 'email',
  INVALID_PASSWORD: 'password',
}

interface AuthFormModel {
  focusFirstInvalid: boolean
  inFlight: number
  issues: Record<string, string>
  message: string | null
  status: AuthFormState['status']
}

interface AuthFormReal {
  state: AuthFormState
}

const assertAuthFormInvariants = (model: AuthFormModel, real: AuthFormReal) => {
  const { state } = real
  expect(state.status).toBe(model.status)
  // Never more than one validation or submission in flight.
  expect(model.inFlight).toBeLessThanOrEqual(1)
  expect(isAuthFormBusy(state)).toBe(model.inFlight === 1)
  if (state.status === 'field-error') {
    expect(state.focusFirstInvalid).toBe(model.focusFirstInvalid)
    expect(state.issues).toEqual(model.issues)
  } else if (state.status === 'form-error') {
    expect(state.message).toBe(model.message)
    expect(state.message.length).toBeGreaterThan(0)
  }
}

const send = (real: AuthFormReal, event: AuthFormEvent) => {
  real.state = transitionAuthForm(real.state, event)
}

class SubmitRequestedCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    send(real, { type: 'SUBMIT_REQUESTED' })
    if (model.status !== 'validating' && model.status !== 'submitting') {
      model.status = 'validating'
      model.inFlight = 1
      model.focusFirstInvalid = false
      model.issues = {}
      model.message = null
    }
    assertAuthFormInvariants(model, real)
  }
  toString = () => 'SUBMIT_REQUESTED'
}

class SchemaLoadFailedCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  readonly message: string
  constructor(message: string) {
    this.message = message
  }
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    send(real, { message: this.message, type: 'SCHEMA_LOAD_FAILED' })
    if (model.status === 'validating') {
      model.status = 'form-error'
      model.inFlight = 0
      model.message = this.message
    }
    assertAuthFormInvariants(model, real)
  }
  toString = () => 'SCHEMA_LOAD_FAILED'
}

class ValidationFailedCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    send(real, { type: 'VALIDATION_FAILED' })
    if (model.status === 'validating') {
      model.status = 'field-error'
      model.inFlight = 0
      model.focusFirstInvalid = true
      model.issues = {}
    }
    assertAuthFormInvariants(model, real)
  }
  toString = () => 'VALIDATION_FAILED'
}

class ValidationPassedCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    send(real, { type: 'VALIDATION_PASSED' })
    if (model.status === 'validating') {
      model.status = 'submitting'
    }
    assertAuthFormInvariants(model, real)
  }
  toString = () => 'VALIDATION_PASSED'
}

class SubmitSucceededCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    send(real, { type: 'SUBMIT_SUCCEEDED' })
    if (model.status === 'submitting') {
      model.status = 'succeeded'
      model.inFlight = 0
    }
    assertAuthFormInvariants(model, real)
  }
  toString = () => 'SUBMIT_SUCCEEDED'
}

class SubmitFailedCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  readonly kind: 'field' | 'form'
  constructor(kind: 'field' | 'form') {
    this.kind = kind
  }
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    const error =
      this.kind === 'field'
        ? new AuthActionError({ code: 'INVALID_PASSWORD' })
        : new AuthActionError({ code: 'INVALID_EMAIL_OR_PASSWORD' })
    send(real, { error, fieldCodes: FIELD_CODES, type: 'SUBMIT_FAILED' })
    if (model.status === 'submitting') {
      model.inFlight = 0
      if (this.kind === 'field') {
        model.status = 'field-error'
        model.focusFirstInvalid = true
        model.issues = { password: 'That password is not correct.' }
      } else {
        model.status = 'form-error'
        model.message = 'Wrong email or password.'
      }
    }
    assertAuthFormInvariants(model, real)
  }
  toString = () => `SUBMIT_FAILED(${this.kind})`
}

class FocusAppliedCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    send(real, { type: 'FOCUS_APPLIED' })
    if (model.status === 'field-error' && model.focusFirstInvalid) {
      model.focusFirstInvalid = false
    }
    assertAuthFormInvariants(model, real)
  }
  toString = () => 'FOCUS_APPLIED'
}

class ResetCommand implements fc.Command<AuthFormModel, AuthFormReal> {
  check = () => true
  run(model: AuthFormModel, real: AuthFormReal) {
    send(real, { type: 'RESET' })
    model.status = 'idle'
    model.inFlight = 0
    model.focusFirstInvalid = false
    model.issues = {}
    model.message = null
    assertAuthFormInvariants(model, real)
  }
  toString = () => 'RESET'
}

const commandArbitrary = fc.commands(
  [
    fc.constant(new SubmitRequestedCommand()),
    fc.constant(new SchemaLoadFailedCommand("Couldn't load the form. Check your connection and try again.")),
    fc.constant(new ValidationFailedCommand()),
    fc.constant(new ValidationPassedCommand()),
    fc.constant(new SubmitSucceededCommand()),
    fc.constant(new SubmitFailedCommand('field')),
    fc.constant(new SubmitFailedCommand('form')),
    fc.constant(new FocusAppliedCommand()),
    fc.constant(new ResetCommand()),
  ],
  { maxCommands: 40 },
)

describe('auth-form-machine', () => {
  it('seeds initial failure state from a non-JS FormData post or starts idle', () => {
    expect(initialAuthFormState()).toEqual({ status: 'idle' })
    expect(initialAuthFormState(new AuthActionError({ code: 'RATE_LIMITED', retryAfter: 5 }))).toEqual({
      message: 'Too many attempts. Try again in 5 seconds.',
      status: 'form-error',
    })
    expect(initialAuthFormState(new AuthActionError({ code: 'INVALID_EMAIL' }), FIELD_CODES)).toEqual({
      focusFirstInvalid: true,
      issues: { email: 'Enter a valid email address.' },
      status: 'field-error',
    })
  })

  it('handles every state and event pair deterministically', () => {
    const states: Array<AuthFormState> = [
      { status: 'idle' },
      { status: 'validating' },
      { status: 'submitting' },
      { focusFirstInvalid: true, issues: { password: 'bad' }, status: 'field-error' },
      { focusFirstInvalid: false, issues: {}, status: 'field-error' },
      { message: 'error', status: 'form-error' },
      { status: 'succeeded' },
    ]
    const events: Array<AuthFormEvent> = [
      { type: 'SUBMIT_REQUESTED' },
      { message: 'chunk failed', type: 'SCHEMA_LOAD_FAILED' },
      { type: 'VALIDATION_FAILED' },
      { type: 'VALIDATION_PASSED' },
      { type: 'SUBMIT_SUCCEEDED' },
      { error: new AuthActionError({ code: 'INVALID_PASSWORD' }), fieldCodes: FIELD_CODES, type: 'SUBMIT_FAILED' },
      { error: new AuthActionError({ code: 'INVALID_EMAIL_OR_PASSWORD' }), type: 'SUBMIT_FAILED' },
      { type: 'FOCUS_APPLIED' },
      { type: 'RESET' },
    ]
    const outcomes = states.flatMap((state) => events.map((event) => transitionAuthForm(state, event)))
    expect(outcomes).toHaveLength(states.length * events.length)
  })

  it('preserves all invariants across arbitrary event sequences', () => {
    fc.assert(
      fc.property(commandArbitrary, (commands) => {
        const model: AuthFormModel = {
          focusFirstInvalid: false,
          inFlight: 0,
          issues: {},
          message: null,
          status: 'idle',
        }
        const real: AuthFormReal = { state: initialAuthFormState() }
        fc.modelRun(() => ({ model, real }), commands)
        expect(real.state.status).toBe(model.status)
      }),
      { numRuns: 200 },
    )
  })
})
