import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useRef } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { CharacterCount, isTooLong } from '#/components/form/character-count.tsx'
import { FieldError } from '#/components/form/field-error.tsx'
import { describedBy, fieldErrorMessage } from '#/components/form/field-messages.ts'
import { loadOnInteraction, useSchemaSubmit } from '#/components/form/lazy-schema.ts'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { useCreatePost } from '#/features/posts/api/create-post.ts'
import { postDraftSchema } from '#/features/posts/utils/post-draft-schema.ts'
import { fieldIssue } from '#/lib/api-error.ts'

export function PostComposer(props: { onPublished?: () => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const create = useCreatePost({
    mutationConfig: {
      onSuccess: () => {
        form.reset()
        textarea.current?.focus()
        props.onPublished?.()
      },
    },
  })
  const form = useForm({
    defaultValues: { body: '' },
    onSubmit: ({ value }) => create.mutate({ body: postDraftSchema.decode(value) }),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: postDraftSchema.validator },
  })
  const { formRef, schemaError, submit } = useSchemaSubmit(form, postDraftSchema)
  const serverIssue = fieldIssue(create.error, 'body')
  const formError = create.isError && serverIssue === undefined ? create.error : null
  return (
    <form
      aria-busy={create.isPending}
      className="grid gap-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (create.isPending) {
          return
        }
        submit()
      }}
      ref={formRef}
      {...loadOnInteraction(postDraftSchema)}
    >
      <form.Field name="body">
        {(field) => {
          const body = field.state.value
          const error = fieldErrorMessage(field.state.meta.errors) ?? serverIssue
          return (
            <>
              <Label htmlFor="post-body">New post</Label>
              <Textarea
                aria-describedby={describedBy(
                  'post-body-count',
                  error && 'post-body-error',
                  formError && 'post-error',
                  schemaError && 'post-schema-error',
                )}
                aria-invalid={isTooLong(body, POST_MAX_LENGTH) || Boolean(error) || undefined}
                id="post-body"
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                ref={textarea}
                required
                value={body}
              />
              <div className="flex items-center justify-between gap-2">
                <CharacterCount id="post-body-count" max={POST_MAX_LENGTH} value={body} />
                <Button aria-disabled={create.isPending || undefined} disabled={body.trim().length === 0} type="submit">
                  Publish
                </Button>
              </div>
              <FieldError id="post-body-error" message={error} />
            </>
          )
        }}
      </form.Field>
      {formError ? <ApiErrorAlert action="publish the post" error={formError} id="post-error" /> : null}
      <FieldError id="post-schema-error" message={schemaError} />
    </form>
  )
}
