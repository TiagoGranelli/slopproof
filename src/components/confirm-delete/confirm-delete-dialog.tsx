import { useRef } from 'react'
import type { RefObject } from 'react'
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

export interface DeletedItem {
  readonly consequence: string
  readonly noun: string
  readonly text: string
}

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
