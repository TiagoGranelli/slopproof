import { cn } from 'cn'
import { setNonce } from 'get-nonce'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { Button } from '#/components/ui/button.tsx'

// Radix locks page scroll while a dialog is open with a <style> element it injects (react-remove-scroll-bar,
// which asks get-nonce for a nonce). The CSP blocks it without the page's nonce (ADR 0010), which the router puts
// in <meta property="csp-nonce">. Runs once, in the browser, when a page that can open a dialog loads.
const pageNonce =
  typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content
if (pageNonce) {
  setNonce(pageNonce)
}

function AlertDialog({ ...props }: ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal({ ...props }: ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({ className, onMouseDown, ...props }: ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn('pointer-events-auto fixed inset-0 z-50 bg-black/40', className)}
      data-slot="alert-dialog-overlay"
      onMouseDown={(event) => {
        onMouseDown?.(event)
        // Alert dialogs ignore outside clicks; preventing default keeps mousedown on the dimmed backdrop
        // from blurring the focused dialog control onto document.body.
        event.preventDefault()
      }}
      {...props}
    />
  )
}

// Trimmed to the default size: every class in this file ships in the render-blocking stylesheet of every page.
function AlertDialogContent({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm',
          className,
        )}
        data-slot="alert-dialog-content"
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid place-items-center gap-1.5 text-center sm:place-items-start sm:text-left', className)}
      data-slot="alert-dialog-header"
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        className,
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('font-heading text-base font-medium', className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      data-slot="alert-dialog-description"
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  size = 'default',
  variant = 'default',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action> & Pick<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button asChild size={size} variant={variant}>
      <AlertDialogPrimitive.Action className={cn(className)} data-slot="alert-dialog-action" {...props} />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  size = 'default',
  variant = 'outline',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel> & Pick<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button asChild size={size} variant={variant}>
      <AlertDialogPrimitive.Cancel className={cn(className)} data-slot="alert-dialog-cancel" {...props} />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
