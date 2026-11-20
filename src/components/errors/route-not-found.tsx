import { Link } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { Button } from '#/components/ui/button.tsx'

export function RouteNotFound() {
  return (
    <Page description="There is nothing at this address." title="Page not found">
      <div>
        <Button asChild variant="outline">
          <Link to="/">Go to the home page</Link>
        </Button>
      </div>
    </Page>
  )
}
