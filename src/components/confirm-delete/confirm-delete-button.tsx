import { lazy, Suspense, useRef, useState } from 'react'
import type { DeletedItem } from '#/components/confirm-delete/confirm-delete-dialog.tsx'
import { Button } from '#/components/ui/button.tsx'
import { truncateCodePoints } from '#/lib/truncate-text.ts'

// The dialog and Radix's dialog code load on the first hover or focus of a Delete button, not with the page:
// preloaded with the dashboard, they delayed its first paint on a throttled phone (Lighthouse FCP).
const loadDialog = () =>
  import('#/components/confirm-delete/confirm-delete-dialog.tsx').then((module) => ({
    default: module.ConfirmDeleteDialog,
  }))
const ConfirmDeleteDialog = lazy(loadDialog)
const preloadDialog = () => {
  // A failed early load is retried by the lazy component when the dialog opens.
  loadDialog().catch(() => {})
}

/**
 * Delete, asked first (ConfirmDeleteDialog). Focus returns here when the dialog closes, and the deletion only starts
 * then; the button stays (aria-disabled, like every pending button) while the request runs, and the caller moves
 * focus on once the item is gone (as MyPost's `onDeleted` does).
 */
export function ConfirmDeleteButton(props: { onConfirm: () => void; pending: boolean; target: DeletedItem }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // Mounted from the first opening on, so closing runs Radix's close (and its focus return) instead of unmounting.
  const [asked, setAsked] = useState(false)
  return (
    <>
      <Button
        aria-disabled={props.pending || undefined}
        aria-haspopup="dialog"
        onClick={() => {
          if (props.pending) {
            return
          }
          setAsked(true)
          setOpen(true)
        }}
        onFocus={preloadDialog}
        onPointerEnter={preloadDialog}
        ref={button}
        size="sm"
        type="button"
        variant="ghost"
      >
        Delete<span className="sr-only"> {`${props.target.noun}: ${truncateCodePoints(props.target.text, 40)}`}</span>
      </Button>
      {asked ? (
        <Suspense fallback={null}>
          <ConfirmDeleteDialog
            onConfirm={props.onConfirm}
            onOpenChange={setOpen}
            open={open}
            returnFocus={button}
            target={props.target}
          />
        </Suspense>
      ) : null}
    </>
  )
}
