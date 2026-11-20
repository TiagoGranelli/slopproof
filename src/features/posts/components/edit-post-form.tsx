import { revalidateLogic, useForm } from '@tanstack/react-form'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { CharacterCount, isTooLong } from '#/components/form/character-count.tsx'
import { FieldError } from '#/components/form/field-error.tsx'
import { describedBy, fieldErrorMessage } from '#/components/form/field-messages.ts'
import { loadOnInteraction, useSchemaSubmit } from '#/components/form/lazy-schema.ts'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { useUpdatePost } from '#/features/posts/api/update-post.ts'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import { postDraftSchema } from '#/features/posts/utils/post-draft-schema.ts'
import { fieldIssue } from '#/lib/api-error.ts'
import type { Post } from '#/sdk/types.gen.ts'

interface EditPostProps {
  readonly onClose: () => void
  readonly onUpdated: (() => void) | undefined
  readonly post: Post
}

/** The update mutation and the form it submits: a save closes the form, then tells the list. */
function useEditPost(props: EditPostProps) {
  const update = useUpdatePost({
    mutationConfig: {
      onSuccess: () => {
        props.onClose()
        props.onUpdated?.()
      },
    },
  })
  const form = useForm({
    defaultValues: { body: props.post.body },
    onSubmit: ({ value }) => update.mutate({ body: postDraftSchema.decode(value), path: { id: props.post.id } }),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: postDraftSchema.validator },
  })
  return { form, update }
}

/** The editor's row under the textarea: the character count, Cancel and Save. */
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

/**
 * The form that replaces a post's body while it is edited. It starts from the saved body with the caret at
 * its end; Save, Cancel and Escape close it through `onClose`. Each opening mounts it afresh, so a cancelled
 * draft or a failed save never shows up again. Checked like the composer: in the browser with the API's rules,
 * a ValidationError next to the field, any other failure under the form.
 */
export function EditPostForm(props: EditPostProps) {
  const { post } = props
  const { form, update } = useEditPost(props)
  const fieldId = `edit-post-${post.id}`
  const { formRef, schemaError, submit } = useSchemaSubmit(form, postDraftSchema)
  const serverIssue = fieldIssue(update.error, 'body')
  const formError = update.isError && serverIssue === undefined ? update.error : null
  return (
    <PostCard post={post}>
      <form
        aria-busy={update.isPending}
        className="grid gap-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (update.isPending) {
            return
          }
          submit()
        }}
        ref={formRef}
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
                    formError && `${fieldId}-alert`,
                    schemaError && `${fieldId}-schema-error`,
                  )}
                  aria-invalid={isTooLong(draft, POST_MAX_LENGTH) || Boolean(error) || undefined}
                  id={fieldId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') {
                      return
                    }
                    event.preventDefault()
                    props.onClose()
                  }}
                  ref={focusAtEnd}
                  required
                  value={draft}
                />
                <EditPostActions
                  countId={`${fieldId}-count`}
                  draft={draft}
                  onCancel={props.onClose}
                  saving={update.isPending}
                />
                <FieldError id={`${fieldId}-error`} message={error} />
              </>
            )
          }}
        </form.Field>
        {formError ? <ApiErrorAlert action="save the post" error={formError} id={`${fieldId}-alert`} /> : null}
        <FieldError id={`${fieldId}-schema-error`} message={schemaError} />
      </form>
    </PostCard>
  )
}
