import { lazy, Suspense, useRef, useState } from 'react'
import type { DeletedItem } from '#/components/confirm-delete/confirm-delete-dialog.tsx'
import { Button } from '#/components/ui/button.tsx'
import { truncateCodePoints } from '#/lib/truncate-text.ts'

const loadDialog = () =>
  import('#/components/confirm-delete/confirm-delete-dialog.tsx').then((module) => ({
    default: module.ConfirmDeleteDialog,
  }))
const ConfirmDeleteDialog = lazy(loadDialog)
const preloadDialog = () => {
  loadDialog().catch(() => {})
}

export function ConfirmDeleteButton(props: { onConfirm: () => void; pending: boolean; target: DeletedItem }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
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
