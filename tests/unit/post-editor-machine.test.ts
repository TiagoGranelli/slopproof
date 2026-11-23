import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  classifyPostSaveError,
  INITIAL_POST_EDITOR_STATE,
  isPostEditorOpen,
  shouldReturnFocusToEdit,
  transitionPostEditor,
} from '#/features/posts/utils/post-editor-machine.ts'
import type { PostEditorError, PostEditorEvent, PostEditorState } from '#/features/posts/utils/post-editor-machine.ts'

interface EditorModel {
  draft: string
  error: PostEditorError | null
  focusInvalid: boolean
  focusTarget: 'edit-button' | 'none'
  inFlightSaves: number
  savedBody: string
  session: symbol
  status: PostEditorState['status']
}

interface EditorReal {
  state: PostEditorState
}

const assertEditorInvariants = (model: EditorModel, real: EditorReal) => {
  const { state } = real
  expect(state.status).toBe(model.status)
  expect(model.inFlightSaves).toBeLessThanOrEqual(1)
  expect(state.status === 'saving').toBe(model.inFlightSaves === 1)
  expect(isPostEditorOpen(state) && shouldReturnFocusToEdit(state)).toBe(false)
  if (state.status === 'viewing') {
    expect(state.focusTarget).toBe(model.focusTarget)
  } else if (state.status === 'cancelled') {
    expect(state.focusTarget).toBe('edit-button')
    expect(state.restoredBody).toBe(model.savedBody)
  } else {
    expect(state.draft).toBe(model.draft)
    expect(state.savedBody).toBe(model.savedBody)
    expect(state.session).toBe(model.session)
  }
}

const applyEvent = (real: EditorReal, event: PostEditorEvent) => {
  real.state = transitionPostEditor(real.state, event)
}

class OpenCommand implements fc.Command<EditorModel, EditorReal> {
  readonly canEdit: boolean
  constructor(canEdit: boolean) {
    this.canEdit = canEdit
  }
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    const session = Symbol('post editor session')
    applyEvent(real, { canEdit: this.canEdit, savedBody: model.savedBody, session, type: 'OPEN' })
    if ((model.status === 'viewing' || model.status === 'cancelled') && this.canEdit) {
      model.status = 'editing'
      model.session = session
      model.draft = model.savedBody
      model.error = null
      model.focusInvalid = false
      model.focusTarget = 'none'
    }
    assertEditorInvariants(model, real)
  }
  toString = () => `OPEN(canEdit=${String(this.canEdit)})`
}

class EditDraftCommand implements fc.Command<EditorModel, EditorReal> {
  readonly draft: string
  constructor(draft: string) {
    this.draft = draft
  }
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    applyEvent(real, { draft: this.draft, type: 'DRAFT_CHANGED' })
    if (model.status === 'editing' || model.status === 'save-failed') {
      model.draft = this.draft
      if (model.status === 'editing') {
        model.focusInvalid = false
      }
    }
    assertEditorInvariants(model, real)
  }
  toString = () => `DRAFT_CHANGED(${JSON.stringify(this.draft)})`
}

class SubmitCommand implements fc.Command<EditorModel, EditorReal> {
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    applyEvent(real, { type: 'SUBMIT' })
    if (model.status === 'editing' || model.status === 'save-failed') {
      model.status = 'saving'
      model.inFlightSaves = 1
      model.error = null
      model.focusInvalid = false
    }
    assertEditorInvariants(model, real)
  }
  toString = () => 'SUBMIT'
}

class ValidationFailedCommand implements fc.Command<EditorModel, EditorReal> {
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    applyEvent(real, { session: model.session, type: 'VALIDATION_FAILED' })
    if (model.status === 'saving') {
      model.status = 'editing'
      model.inFlightSaves = 0
      model.focusInvalid = true
    }
    assertEditorInvariants(model, real)
  }
  toString = () => 'VALIDATION_FAILED'
}

class SaveSucceededCommand implements fc.Command<EditorModel, EditorReal> {
  readonly saved: string
  constructor(saved: string) {
    this.saved = saved
  }
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    applyEvent(real, { body: this.saved, session: model.session, type: 'SAVE_SUCCEEDED' })
    if (model.status === 'saving') {
      model.status = 'viewing'
      model.savedBody = this.saved
      model.inFlightSaves = 0
      model.focusTarget = 'edit-button'
    }
    assertEditorInvariants(model, real)
  }
  toString = () => `SAVE_SUCCEEDED(${JSON.stringify(this.saved)})`
}

class SaveFailedCommand implements fc.Command<EditorModel, EditorReal> {
  readonly error: PostEditorError
  constructor(error: PostEditorError) {
    this.error = error
  }
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    applyEvent(real, { error: this.error, session: model.session, type: 'SAVE_FAILED' })
    if (model.status === 'saving') {
      model.status = 'save-failed'
      model.inFlightSaves = 0
      model.error = this.error
    }
    assertEditorInvariants(model, real)
  }
  toString = () => `SAVE_FAILED(${this.error.kind})`
}

class CancelCommand implements fc.Command<EditorModel, EditorReal> {
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    applyEvent(real, { type: 'CANCEL' })
    if (model.status === 'editing' || model.status === 'saving' || model.status === 'save-failed') {
      model.status = 'cancelled'
      model.inFlightSaves = 0
      model.error = null
      model.focusInvalid = false
      model.focusTarget = 'edit-button'
    }
    assertEditorInvariants(model, real)
  }
  toString = () => 'CANCEL'
}

class FocusReturnedCommand implements fc.Command<EditorModel, EditorReal> {
  check = () => true
  run(model: EditorModel, real: EditorReal) {
    applyEvent(real, { type: 'FOCUS_RETURNED' })
    if (model.status === 'cancelled') {
      model.status = 'viewing'
      model.focusTarget = 'none'
    } else if (model.status === 'viewing' && model.focusTarget === 'edit-button') {
      model.focusTarget = 'none'
    } else if (model.status === 'editing' && model.focusInvalid) {
      model.focusInvalid = false
    }
    assertEditorInvariants(model, real)
  }
  toString = () => 'FOCUS_RETURNED'
}

const errorArbitrary: fc.Arbitrary<PostEditorError> = fc.oneof(
  fc.string({ maxLength: 30, minLength: 1 }).map((message) => ({ kind: 'field' as const, message })),
  fc.string({ maxLength: 30, minLength: 1 }).map((message) => ({ kind: 'schema' as const, message })),
  fc.constant<PostEditorError>({ error: new Error('network'), kind: 'form' }),
)

const commandArbitrary = fc.commands(
  [
    fc.boolean().map((canEdit) => new OpenCommand(canEdit)),
    fc.string({ maxLength: 40 }).map((draft) => new EditDraftCommand(draft)),
    fc.constant(new SubmitCommand()),
    fc.constant(new ValidationFailedCommand()),
    fc.string({ maxLength: 40, minLength: 1 }).map((saved) => new SaveSucceededCommand(saved)),
    errorArbitrary.map((error) => new SaveFailedCommand(error)),
    fc.constant(new CancelCommand()),
    fc.constant(new FocusReturnedCommand()),
  ],
  { maxCommands: 40 },
)

describe('post-editor-machine', () => {
  it('classifies field validation errors and form errors separately', () => {
    const fieldError = classifyPostSaveError({
      _tag: 'ValidationError',
      issues: [{ message: 'Too long.', path: ['body'] }],
      message: 'Invalid request payload',
    })
    expect(fieldError).toEqual({ kind: 'field', message: 'Too long.' })
    const network = new Error('network')
    expect(classifyPostSaveError(network)).toEqual({ error: network, kind: 'form' })
  })

  it('refuses to open while deletion is pending, and returns focus on cancel or save', () => {
    const blocked = transitionPostEditor(INITIAL_POST_EDITOR_STATE, {
      canEdit: false,
      savedBody: 'original',
      session: Symbol('post editor session'),
      type: 'OPEN',
    })
    expect(blocked).toEqual(INITIAL_POST_EDITOR_STATE)
    const opened = transitionPostEditor(INITIAL_POST_EDITOR_STATE, {
      canEdit: true,
      savedBody: 'original',
      session: Symbol('post editor session'),
      type: 'OPEN',
    })
    const edited = transitionPostEditor(opened, { draft: 'discarded', type: 'DRAFT_CHANGED' })
    const cancelled = transitionPostEditor(edited, { type: 'CANCEL' })
    expect(cancelled).toEqual({ focusTarget: 'edit-button', restoredBody: 'original', status: 'cancelled' })
    expect(shouldReturnFocusToEdit(cancelled)).toBe(true)
    const focused = transitionPostEditor(cancelled, { type: 'FOCUS_RETURNED' })
    expect(focused).toEqual(INITIAL_POST_EDITOR_STATE)
  })

  it('handles every state and event pair deterministically', () => {
    const sampleError: PostEditorError = { kind: 'field', message: 'Too long.' }
    const session = Symbol('post editor session')
    const states: Array<PostEditorState> = [
      INITIAL_POST_EDITOR_STATE,
      { focusTarget: 'edit-button', status: 'viewing' },
      { focusTarget: 'edit-button', restoredBody: 'saved', status: 'cancelled' },
      { draft: 'draft', focusInvalid: false, savedBody: 'saved', session, status: 'editing' },
      { draft: 'draft', focusInvalid: true, savedBody: 'saved', session, status: 'editing' },
      { draft: 'draft', savedBody: 'saved', session, status: 'saving' },
      { draft: 'draft', error: sampleError, savedBody: 'saved', session, status: 'save-failed' },
    ]
    const events: Array<PostEditorEvent> = [
      { canEdit: true, savedBody: 'saved', session, type: 'OPEN' },
      { canEdit: false, savedBody: 'saved', session, type: 'OPEN' },
      { draft: 'revised', type: 'DRAFT_CHANGED' },
      { type: 'SUBMIT' },
      { session, type: 'VALIDATION_FAILED' },
      { body: 'revised', session, type: 'SAVE_SUCCEEDED' },
      { error: sampleError, session, type: 'SAVE_FAILED' },
      { type: 'CANCEL' },
      { type: 'FOCUS_RETURNED' },
    ]
    const outcomes = states.flatMap((state) => events.map((event) => transitionPostEditor(state, event)))
    expect(outcomes).toHaveLength(states.length * events.length)
  })

  it('ignores every late outcome from a cancelled editor while its replacement saves', () => {
    fc.assert(
      fc.property(fc.string(), errorArbitrary, (savedBody, error) => {
        const cancelledSession = Symbol('post editor session')
        const session = Symbol('post editor session')
        const opened = transitionPostEditor(INITIAL_POST_EDITOR_STATE, {
          canEdit: true,
          savedBody,
          session: cancelledSession,
          type: 'OPEN',
        })
        const firstSave = transitionPostEditor(opened, { type: 'SUBMIT' })
        const cancelled = transitionPostEditor(firstSave, { type: 'CANCEL' })
        const reopened = transitionPostEditor(cancelled, { canEdit: true, savedBody, session, type: 'OPEN' })
        const saving = transitionPostEditor(reopened, { type: 'SUBMIT' })
        const stale: Array<PostEditorEvent> = [
          { session: cancelledSession, type: 'VALIDATION_FAILED' },
          { error, session: cancelledSession, type: 'SAVE_FAILED' },
          { body: savedBody, session: cancelledSession, type: 'SAVE_SUCCEEDED' },
        ]
        expect(stale.map((event) => transitionPostEditor(saving, event))).toEqual([saving, saving, saving])
        expect(transitionPostEditor(saving, { body: savedBody, session, type: 'SAVE_SUCCEEDED' })).toEqual({
          focusTarget: 'edit-button',
          status: 'viewing',
        })
      }),
    )
  })

  it('preserves all invariants across arbitrary event sequences', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40, minLength: 1 }), commandArbitrary, (initialBody, commands) => {
        const model: EditorModel = {
          draft: initialBody,
          error: null,
          focusInvalid: false,
          focusTarget: 'none',
          inFlightSaves: 0,
          savedBody: initialBody,
          session: Symbol('post editor session'),
          status: 'viewing',
        }
        const real: EditorReal = { state: INITIAL_POST_EDITOR_STATE }
        fc.modelRun(() => ({ model, real }), commands)
        expect(real.state.status).toBe(model.status)
      }),
      { numRuns: 200 },
    )
  })
})
