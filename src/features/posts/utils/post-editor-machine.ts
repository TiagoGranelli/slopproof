import { fieldIssue } from '#/lib/api-error.ts'

export type PostEditorError =
  | { readonly kind: 'field'; readonly message: string }
  | { readonly error: unknown; readonly kind: 'form' }
  | { readonly kind: 'schema'; readonly message: string }

export type PostEditorState =
  | { readonly focusTarget: 'edit-button' | 'none'; readonly status: 'viewing' }
  | {
      readonly draft: string
      readonly focusInvalid: boolean
      readonly savedBody: string
      readonly session: symbol
      readonly status: 'editing'
    }
  | { readonly draft: string; readonly savedBody: string; readonly session: symbol; readonly status: 'saving' }
  | {
      readonly draft: string
      readonly error: PostEditorError
      readonly savedBody: string
      readonly session: symbol
      readonly status: 'save-failed'
    }
  | { readonly focusTarget: 'edit-button'; readonly restoredBody: string; readonly status: 'cancelled' }

export type OpenPostEditorState = Extract<PostEditorState, { readonly status: 'editing' | 'save-failed' | 'saving' }>

export type PostEditorEvent =
  | { readonly canEdit: boolean; readonly savedBody: string; readonly session: symbol; readonly type: 'OPEN' }
  | { readonly draft: string; readonly type: 'DRAFT_CHANGED' }
  | { readonly type: 'SUBMIT' }
  | { readonly session: symbol; readonly type: 'VALIDATION_FAILED' }
  | { readonly body: string; readonly session: symbol; readonly type: 'SAVE_SUCCEEDED' }
  | { readonly error: PostEditorError; readonly session: symbol; readonly type: 'SAVE_FAILED' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'FOCUS_RETURNED' }

export const INITIAL_POST_EDITOR_STATE: PostEditorState = { focusTarget: 'none', status: 'viewing' }

export const classifyPostSaveError = (error: unknown): PostEditorError => {
  const issue = fieldIssue(error, 'body')
  return issue !== undefined ? { kind: 'field', message: issue } : { error, kind: 'form' }
}

export const isPostEditorOpen = (state: PostEditorState): state is OpenPostEditorState =>
  state.status === 'editing' || state.status === 'saving' || state.status === 'save-failed'

export const shouldReturnFocusToEdit = (state: PostEditorState): boolean =>
  state.status === 'cancelled' || (state.status === 'viewing' && state.focusTarget === 'edit-button')

const openEditor = (
  event: Extract<PostEditorEvent, { readonly type: 'OPEN' }>,
  state: PostEditorState,
): PostEditorState =>
  event.canEdit
    ? {
        draft: event.savedBody,
        focusInvalid: false,
        savedBody: event.savedBody,
        session: event.session,
        status: 'editing',
      }
    : state

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
      return { draft: state.draft, savedBody: state.savedBody, session: state.session, status: 'saving' }
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

type SavingPostEditorState = Extract<PostEditorState, { readonly status: 'saving' }>

const transitionSaving = (state: SavingPostEditorState, event: PostEditorEvent): PostEditorState => {
  const { draft, savedBody, session } = state
  switch (event.type) {
    case 'VALIDATION_FAILED':
      return { draft, focusInvalid: true, savedBody, session, status: 'editing' }
    case 'SAVE_SUCCEEDED':
      return { focusTarget: 'edit-button', status: 'viewing' }
    case 'SAVE_FAILED':
      return { draft, error: event.error, savedBody, session, status: 'save-failed' }
    case 'CANCEL':
      return { focusTarget: 'edit-button', restoredBody: savedBody, status: 'cancelled' }
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
      return { draft: state.draft, savedBody: state.savedBody, session: state.session, status: 'saving' }
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

export const transitionPostEditor = (state: PostEditorState, event: PostEditorEvent): PostEditorState => {
  if (event.type !== 'OPEN' && 'session' in event && (!isPostEditorOpen(state) || event.session !== state.session)) {
    return state
  }
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
