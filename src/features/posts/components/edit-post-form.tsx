import { revalidateLogic, useForm } from '@tanstack/react-form'
import type { Dispatch } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { CharacterCount, isTooLong } from '#/components/form/character-count.tsx'
import { FieldError } from '#/components/form/field-error.tsx'
import { describedBy, fieldErrorMessage, focusFirstInvalid } from '#/components/form/field-messages.ts'
import { loadOnInteraction, SCHEMA_LOAD_FAILED } from '#/components/form/lazy-schema.ts'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { useUpdatePost } from '#/features/posts/api/update-post.ts'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import { postDraftSchema } from '#/features/posts/utils/post-draft-schema.ts'
import { classifyPostSaveError } from '#/features/posts/utils/post-editor-machine.ts'
import type { OpenPostEditorState, PostEditorEvent } from '#/features/posts/utils/post-editor-machine.ts'
import type { Post } from '#/sdk/types.gen.ts'

interface EditPostProps {
  readonly dispatch: Dispatch<PostEditorEvent>
  readonly onUpdated: (() => void) | undefined
  readonly post: Post
  readonly state: OpenPostEditorState
}

function useEditPost(props: EditPostProps) {
  const update = useUpdatePost()
  const form = useForm({
    defaultValues: { body: props.state.draft },
    onSubmit: ({ value }) => {
      update.mutate(
        { body: postDraftSchema.decode(value), path: { id: props.post.id } },
        {
          onError: (error) => props.dispatch({ error: classifyPostSaveError(error), type: 'SAVE_FAILED' }),
          onSuccess: (updated) => {
            props.dispatch({ body: updated.body, type: 'SAVE_SUCCEEDED' })
            props.onUpdated?.()
          },
        },
      )
    },
    onSubmitInvalid: () => props.dispatch({ type: 'VALIDATION_FAILED' }),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: postDraftSchema.validator },
  })
  return form
}

function EditPostActions(props: { countId: string; draft: string; onCancel: () => void; saving: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <CharacterCount id={props.countId} max={POST_MAX_LENGTH} value={props.draft} />
      <div className="flex gap-2">
        <Button onClick={props.onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button aria-disabled={props.saving || undefined} disabled={props.draft.trim().length === 0} type="submit">
          Save
        </Button>
      </div>
    </div>
  )
}

const focusAtEnd = (field: HTMLTextAreaElement | null) => {
  if (!field) {
    return
  }
  field.focus()
  field.setSelectionRange(field.value.length, field.value.length)
}

const editorErrors = (state: OpenPostEditorState) => {
  if (state.status !== 'save-failed') {
    return { formError: null, schemaError: undefined, serverIssue: undefined }
  }
  return {
    formError: state.error.kind === 'form' ? state.error.error : null,
    schemaError: state.error.kind === 'schema' ? state.error.message : undefined,
    serverIssue: state.error.kind === 'field' ? state.error.message : undefined,
  }
}

const focusInvalidField = (dispatch: Dispatch<PostEditorEvent>) => (element: HTMLFormElement | null) => {
  if (!element) {
    return
  }
  focusFirstInvalid(element)
  dispatch({ type: 'FOCUS_RETURNED' })
}

const submitEditForm = async (
  dispatch: Dispatch<PostEditorEvent>,
  form: { handleSubmit: () => Promise<void> },
  saving: boolean,
) => {
  if (saving) {
    return
  }
  dispatch({ type: 'SUBMIT' })
  const loaded = await postDraftSchema
    .load()
    .then(() => true)
    .catch(() => false)
  if (!loaded) {
    dispatch({ error: { kind: 'schema', message: SCHEMA_LOAD_FAILED }, type: 'SAVE_FAILED' })
    return
  }
  await form.handleSubmit()
}

export function EditPostForm(props: EditPostProps) {
  const { dispatch, post, state } = props
  const form = useEditPost(props)
  const fieldId = `edit-post-${post.id}`
  const saving = state.status === 'saving'
  const { formError, schemaError, serverIssue } = editorErrors(state)

  return (
    <PostCard post={post}>
      <form
        aria-busy={saving}
        className="grid gap-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submitEditForm(dispatch, form, saving)
        }}
        ref={state.status === 'editing' && state.focusInvalid ? focusInvalidField(dispatch) : undefined}
        {...loadOnInteraction(postDraftSchema)}
      >
        <form.Field name="body">
          {(field) => {
            const draft = field.state.value
            const error = fieldErrorMessage(field.state.meta.errors) ?? serverIssue
            return (
              <>
                <Label htmlFor={fieldId}>Edit post</Label>
                <Textarea
                  aria-describedby={describedBy(
                    `${fieldId}-count`,
                    error && `${fieldId}-error`,
                    formError !== null && `${fieldId}-alert`,
                    schemaError && `${fieldId}-schema-error`,
                  )}
                  aria-invalid={isTooLong(draft, POST_MAX_LENGTH) || Boolean(error) || undefined}
                  id={fieldId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const nextDraft = event.target.value
                    field.handleChange(nextDraft)
                    dispatch({ draft: nextDraft, type: 'DRAFT_CHANGED' })
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') {
                      return
                    }
                    event.preventDefault()
                    dispatch({ type: 'CANCEL' })
                  }}
                  ref={focusAtEnd}
                  required
                  value={draft}
                />
                <EditPostActions
                  countId={`${fieldId}-count`}
                  draft={draft}
                  onCancel={() => dispatch({ type: 'CANCEL' })}
                  saving={saving}
                />
                <FieldError id={`${fieldId}-error`} message={error} />
              </>
            )
          }}
        </form.Field>
        {formError !== null ? <ApiErrorAlert action="save the post" error={formError} id={`${fieldId}-alert`} /> : null}
        <FieldError id={`${fieldId}-schema-error`} message={schemaError} />
      </form>
    </PostCard>
  )
}
