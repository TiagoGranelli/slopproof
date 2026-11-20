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
import type { Post } from '#/sdk/types.gen.ts'

// The editor loads on the first hover or focus of an Edit button, not with the dashboard, whose first paint on a
// throttled phone counts every preloaded byte (Lighthouse FCP).
const loadEditor = () =>
  import('#/features/posts/components/edit-post-form.tsx').then((module) => ({ default: module.EditPostForm }))
const EditPostForm = lazy(loadEditor)
const preloadEditor = () => {
  // A failed early load is retried by the lazy component when the editor opens.
  loadEditor().catch(() => {})
}

/**
 * One of the author's posts, with Edit and Delete. Edit swaps the body for a form driven by `post-editor-machine`;
 * focus moves into the textarea and returns to the Edit button on Save or Cancel. Delete asks first
 * (ConfirmDeleteButton).
 */
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
    // Keep the Suspense boundary mounted across view/edit transitions so React 19's `startTransition` retains the
    // focused Edit button while the lazy EditPostForm chunk loads instead of unmounting into the fallback (ADR 0018).
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
                Edit<span className="sr-only"> post: {post.body.slice(0, 40)}</span>
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
