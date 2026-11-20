import { lazy, startTransition, Suspense, useReducer } from 'react'
import { ConfirmDeleteButton } from '#/components/confirm-delete/confirm-delete-button.tsx'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import { isPostNotFound, useDeletePost } from '#/features/posts/api/delete-post.ts'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import {
  INITIAL_POST_EDITOR_STATE,
  isPostEditorOpen,
  shouldReturnFocusToEdit,
  transitionPostEditor,
} from '#/features/posts/utils/post-editor-machine.ts'
import { truncateCodePoints } from '#/lib/truncate-text.ts'
import type { Post } from '#/sdk/types.gen.ts'

const loadEditor = () =>
  import('#/features/posts/components/edit-post-form.tsx').then((module) => ({ default: module.EditPostForm }))
const EditPostForm = lazy(loadEditor)
const preloadEditor = () => {
  loadEditor().catch(() => {})
}

export function MyPost(props: { onDeleted?: () => void; onUpdated?: () => void; post: Post }) {
  const { post } = props
  const [editor, dispatch] = useReducer(transitionPostEditor, INITIAL_POST_EDITOR_STATE)
  const remove = useDeletePost({ mutationConfig: { onSuccess: () => props.onDeleted?.() } })

  const focusEditButton = (button: HTMLButtonElement | null) => {
    if (!button) {
      return
    }
    button.focus()
    dispatch({ type: 'FOCUS_RETURNED' })
  }

  return (
    <Suspense fallback={<PostCard busy post={post} />}>
      {isPostEditorOpen(editor) ? (
        <EditPostForm dispatch={dispatch} onUpdated={props.onUpdated} post={post} state={editor} />
      ) : (
        <PostCard
          actions={
            <>
              <Button
                aria-disabled={remove.isPending || undefined}
                onClick={() =>
                  startTransition(() => dispatch({ canEdit: !remove.isPending, savedBody: post.body, type: 'OPEN' }))
                }
                onFocus={preloadEditor}
                onPointerEnter={preloadEditor}
                ref={shouldReturnFocusToEdit(editor) ? focusEditButton : undefined}
                size="sm"
                type="button"
                variant="ghost"
              >
                Edit<span className="sr-only"> post: {truncateCodePoints(post.body, 40)}</span>
              </Button>
              <ConfirmDeleteButton
                onConfirm={() => remove.mutate({ path: { id: post.id } })}
                pending={remove.isPending}
                target={{
                  consequence: 'It will be gone for good, from your posts and from the public list.',
                  noun: 'post',
                  text: post.body,
                }}
              />
            </>
          }
          alert={
            remove.isError && !isPostNotFound(remove.error) ? (
              <ApiErrorAlert action="delete the post" error={remove.error} />
            ) : null
          }
          busy={remove.isPending}
          post={post}
        />
      )}
    </Suspense>
  )
}
