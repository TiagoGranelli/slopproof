import { cn } from 'cn'
import type { ComponentProps } from 'react'

// Trimmed from radix-nova: no file-input styles (no file inputs here), and an invalid field is its full destructive
// border, without the tinted ring (a box shadow, gone in forced colors) or the dark theme's half-strength border.
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  )
}

export { Textarea }
