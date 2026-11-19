import { cn } from 'cn'
import type { ComponentProps } from 'react'

// radix-nova's card, trimmed to the parts this app uses: every class in this file ships in the render-blocking
// stylesheet of every page, used or not. `pnpm exec shadcn add card --overwrite` restores the rest (header, title,
// action, footer, the small size).

function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10',
        className,
      )}
      data-slot="card"
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-sm text-muted-foreground', className)} data-slot="card-description" {...props} />
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-4', className)} data-slot="card-content" {...props} />
}

export { Card, CardContent, CardDescription }
