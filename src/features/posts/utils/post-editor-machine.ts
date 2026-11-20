import { fieldIssue } from '#/lib/api-error.ts'

/** Why a post save could not complete: a field validation issue, a schema chunk load failure, or a form-level error. */
export type PostEditorError =
  | { readonly kind: 'field'; readonly message: string }
  | { readonly error: unknown; readonly kind: 'form' }
  | { readonly kind: 'schema'; readonly message: string }

/** Explicit states of an inline post editor. */
export type PostEditorState =
  | { readonly focusTarget: 'edit-button' | 'none'; readonly status: 'viewing' }
  | {
      readonly draft: string
      readonly focusInvalid: boolean
      readonly savedBody: string
      readonly status: 'editing'
    }
  | { readonly draft: string; readonly savedBody: string; readonly status: 'saving' }
  | {
      readonly draft: string
      readonly error: PostEditorError
      readonly savedBody: string
      readonly status: 'save-failed'
    }
  | { readonly focusTarget: 'edit-button'; readonly restoredBody: string; readonly status: 'cancelled' }

/** Active states where the edit form is mounted in place of the read-only card. */
export type OpenPostEditorState = Extract<PostEditorState, { readonly status: 'editing' | 'save-failed' | 'saving' }>

/** Every event the post editor state chart handles. */
export type PostEditorEvent =
  | { readonly canEdit: boolean; readonly savedBody: string; readonly type: 'OPEN' }
  | { readonly draft: string; readonly type: 'DRAFT_CHANGED' }
  | { readonly type: 'SUBMIT' }
  | { readonly type: 'VALIDATION_FAILED' }
  | { readonly body: string; readonly type: 'SAVE_SUCCEEDED' }
  | { readonly error: PostEditorError; readonly type: 'SAVE_FAILED' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'FOCUS_RETURNED' }

/** Initial state when a post card mounts: viewing without moving focus. */
export const INITIAL_POST_EDITOR_STATE: PostEditorState = { focusTarget: 'none', status: 'viewing' }

/** Maps an API or network save error onto a field error or a form-level alert. */
export const classifyPostSaveError = (error: unknown): PostEditorError => {
  const issue = fieldIssue(error, 'body')
  return issue !== undefined ? { kind: 'field', message: issue } : { error, kind: 'form' }
}

/** True when the inline editor form should be shown in place of the read-only card. */
export const isPostEditorOpen = (state: PostEditorState): state is OpenPostEditorState =>
  state.status === 'editing' || state.status === 'saving' || state.status === 'save-failed'

/** True when the read-only card should move focus back to its Edit button on commit. */
export const shouldReturnFocusToEdit = (state: PostEditorState): boolean =>
  state.status === 'cancelled' || (state.status === 'viewing' && state.focusTarget === 'edit-button')

const openEditor = (
  event: Extract<PostEditorEvent, { readonly type: 'OPEN' }>,
  state: PostEditorState,
): PostEditorState =>
  event.canEdit ? { draft: event.savedBody, focusInvalid: false, savedBody: event.savedBody, status: 'editing' } : state

const transitionViewing = (
  state: Extract<PostEditorState, { readonly status: 'viewing' }>,
  event: PostEditorEvent,
): PostEditorState => {
  switch (event.type) {
    case 'OPEN':
      return openEditor(event, state)
    case 'FOCUS_RETURNED':
      return state.focusTarget === 'edit-button' ? INITIAL_POST_EDITOR_STATE : state
    case 'CANCEL':
    case 'DRAFT_CHANGED':
    case 'SAVE_FAILED':
    case 'SAVE_SUCCEEDED':
    case 'SUBMIT':
    case 'VALIDATION_FAILED':
      return state
  }
}

const transitionCancelled = (
  state: Extract<PostEditorState, { readonly status: 'cancelled' }>,
  event: PostEditorEvent,
): PostEditorState => {
  switch (event.type) {
    case 'OPEN':
      return openEditor(event, state)
    case 'FOCUS_RETURNED':
      return INITIAL_POST_EDITOR_STATE
    case 'CANCEL':
    case 'DRAFT_CHANGED':
    case 'SAVE_FAILED':
    case 'SAVE_SUCCEEDED':
    case 'SUBMIT':
    case 'VALIDATION_FAILED':
      return state
  }
}

const transitionEditing = (
  state: Extract<PostEditorState, { readonly status: 'editing' }>,
  event: PostEditorEvent,
): PostEditorState => {
  switch (event.type) {
    case 'DRAFT_CHANGED':
      return { ...state, draft: event.draft, focusInvalid: false }
    case 'SUBMIT':
      return { draft: state.draft, savedBody: state.savedBody, status: 'saving' }
    case 'CANCEL':
      return { focusTarget: 'edit-button', restoredBody: state.savedBody, status: 'cancelled' }
    case 'FOCUS_RETURNED':
      return state.focusInvalid ? { ...state, focusInvalid: false } : state
    case 'OPEN':
    case 'SAVE_FAILED':
    case 'SAVE_SUCCEEDED':
    case 'VALIDATION_FAILED':
      return state
  }
}

const transitionSaving = (
  state: Extract<PostEditorState, { readonly status: 'saving' }>,
  event: PostEditorEvent,
): PostEditorState => {
  switch (event.type) {
    case 'VALIDATION_FAILED':
      return { draft: state.draft, focusInvalid: true, savedBody: state.savedBody, status: 'editing' }
    case 'SAVE_SUCCEEDED':
      return { focusTarget: 'edit-button', status: 'viewing' }
    case 'SAVE_FAILED':
      return { draft: state.draft, error: event.error, savedBody: state.savedBody, status: 'save-failed' }
    case 'CANCEL':
      return { focusTarget: 'edit-button', restoredBody: state.savedBody, status: 'cancelled' }
    case 'DRAFT_CHANGED':
    case 'FOCUS_RETURNED':
    case 'OPEN':
    case 'SUBMIT':
      return state
  }
}

const transitionSaveFailed = (
  state: Extract<PostEditorState, { readonly status: 'save-failed' }>,
  event: PostEditorEvent,
): PostEditorState => {
  switch (event.type) {
    case 'DRAFT_CHANGED':
      return { ...state, draft: event.draft }
    case 'SUBMIT':
      return { draft: state.draft, savedBody: state.savedBody, status: 'saving' }
    case 'CANCEL':
      return { focusTarget: 'edit-button', restoredBody: state.savedBody, status: 'cancelled' }
    case 'FOCUS_RETURNED':
    case 'OPEN':
    case 'SAVE_FAILED':
    case 'SAVE_SUCCEEDED':
    case 'VALIDATION_FAILED':
      return state
  }
}

/** Pure state transition function for the inline post editor. */
export const transitionPostEditor = (state: PostEditorState, event: PostEditorEvent): PostEditorState => {
  switch (state.status) {
    case 'viewing':
      return transitionViewing(state, event)
    case 'cancelled':
      return transitionCancelled(state, event)
    case 'editing':
      return transitionEditing(state, event)
    case 'saving':
      return transitionSaving(state, event)
    case 'save-failed':
      return transitionSaveFailed(state, event)
  }
}
