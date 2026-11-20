import { Page } from '#/components/layouts/page.tsx'

export function RoutePending() {
  return (
    <div aria-busy="true">
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-0.5 bg-primary motion-safe:animate-pulse" />
      <Page title={<output className="text-base font-normal text-muted-foreground">Loading…</output>} />
    </div>
  )
}
