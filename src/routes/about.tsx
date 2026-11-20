import { createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'

export const Route = createFileRoute('/about')({
  component: About,
  head: () => ({ meta: [{ title: pageTitle('About') }] }),
})

function About() {
  return (
    <Page title="About">
      <p className="leading-relaxed text-pretty">
        This app’s API contract, generated SDK, running API and tests are checked against each other in CI.
      </p>
    </Page>
  )
}
