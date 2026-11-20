import { lazy, Suspense, useRef, useState } from 'react'
import { ConfirmDeleteButton } from '#/components/confirm-delete/confirm-delete-button.tsx'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import { isPostNotFound, useDeletePost } from '#/features/posts/api/delete-post.ts'
import { PostCard } from '#/features/posts/components/post-card.tsx'
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
 * One of the author's posts, with Edit and Delete. Edit swaps the body for a form; focus moves into the
 * textarea and returns to the Edit button on Save or Cancel. Delete asks first (ConfirmDeleteButton).
 */
export function MyPost(props: { onDeleted?: () => void; onUpdated?: () => void; post: Post }) {
  const { post } = props
  const [editing, setEditing] = useState(false)
  const returnFocus = useRef(false)
  const remove = useDeletePost({ mutationConfig: { onSuccess: () => props.onDeleted?.() } })

  const focusEditButton = (button: HTMLButtonElement | null) => {
    if (!button || !returnFocus.current) {
      return
    }
    returnFocus.current = false
    button.focus()
  }

  if (editing) {
    return (
      <Suspense fallback={<PostCard busy post={post} />}>
        <EditPostForm
          onClose={() => {
            returnFocus.current = true
            setEditing(false)
          }}
          onUpdated={props.onUpdated}
          post={post}
        />
      </Suspense>
    )
  }

  return (
    <PostCard
      actions={
        <>
          <Button
            aria-disabled={remove.isPending || undefined}
            onClick={() => {
              if (!remove.isPending) {
                setEditing(true)
              }
            }}
            onFocus={preloadEditor}
            onPointerEnter={preloadEditor}
            ref={focusEditButton}
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
  )
}
