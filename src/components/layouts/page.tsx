import type { ReactNode } from 'react'
import { FlashMessage } from '#/components/layouts/flash-message.tsx'
import { cn } from '#/lib/utils.ts'

const markHydrated = (node: HTMLDivElement | null) => {
  if (node) {
    document.body.dataset.hydrated = 'true'
  }
}

export function Page(props: {
  actions?: ReactNode
  children?: ReactNode
  description?: ReactNode
  narrow?: boolean
  title: ReactNode
}) {
  return (
    <div
      className={cn('mx-auto grid w-full gap-8 px-4 py-10 sm:py-14', props.narrow ? 'max-w-sm' : 'max-w-2xl')}
      ref={markHydrated}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-balance outline-none" tabIndex={-1}>
            {props.title}
          </h1>
          {props.description === undefined ? null : (
            <p className="text-pretty text-muted-foreground">{props.description}</p>
          )}
        </div>
        {props.actions}
      </div>
      <FlashMessage />
      {props.children}
    </div>
  )
}
