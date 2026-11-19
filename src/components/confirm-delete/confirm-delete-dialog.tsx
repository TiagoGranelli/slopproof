import { type RefObject, useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog.tsx'

/** What a Delete button removes, as its label and its dialog name it. */
export interface DeletedItem {
  /** What deleting it means, under the dialog's title. */
  readonly consequence: string
  /** Names the kind of item: `post` gives "Delete post: …" and "Delete this post?". */
  readonly noun: string
  /** The item's text: quoted in the dialog, and its start names the button for screen readers. */
  readonly text: string
}

/**
 * The question Delete asks (ConfirmDeleteButton loads it on demand): an alert dialog (Radix: focus trapped inside,
 * Escape and Keep it close it). Keep it has the initial focus, so Enter alone never deletes. On close, focus goes
 * back to `returnFocus`, and only then does a confirmed deletion start, so focus is on a button that exists while
 * the request runs.
 */
export function ConfirmDeleteDialog(props: {
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocus: RefObject<HTMLButtonElement | null>
  target: DeletedItem
}) {
  const confirmed = useRef(false)
  return (
    <AlertDialog onOpenChange={props.onOpenChange} open={props.open}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // Opened without a Radix trigger, so Radix does not know where focus came from.
          event.preventDefault()
          props.returnFocus.current?.focus()
          if (!confirmed.current) {
            return
          }
          confirmed.current = false
          props.onConfirm()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this {props.target.noun}?</AlertDialogTitle>
          <AlertDialogDescription>{props.target.consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <blockquote className="border-l-2 pl-3 text-sm break-words whitespace-pre-wrap">{props.target.text}</blockquote>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={() => (confirmed.current = true)} variant="destructive">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
