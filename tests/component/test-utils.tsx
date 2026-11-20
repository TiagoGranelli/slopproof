import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterContextProvider,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { expect, onTestFinished } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { createQueryClient } from '#/lib/query-client.ts'

const PATHS = [
  '/',
  '/about',
  '/login',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/dashboard',
  '/account',
]

export const testQueryClient = () =>
  createQueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false, staleTime: 30_000 } } })

export async function renderInApp(
  ui: ReactNode,
  options: { queryClient?: QueryClient; route?: { path: string; route: AnyRoute }; url?: string } = {},
) {
  const queryClient = options.queryClient ?? testQueryClient()
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  })
  const mounted = options.route
  mounted?.route.update({ getParentRoute: () => rootRoute, id: mounted.path, path: mounted.path } as never)
  const router = createRouter({
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [options.url ?? '/'] }),
    routeTree: rootRoute.addChildren([
      ...PATHS.flatMap((path) =>
        path === mounted?.path ? [] : [createRoute({ component: () => null, getParentRoute: () => rootRoute, path })],
      ),
      ...(mounted ? [mounted.route] : []),
    ]),
  })
  await router.load()
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...screen, queryClient, router }
}

export async function serverRendered(ui: ReactNode, options: { url?: string } = {}) {
  const { queryClient, router, unmount } = await renderInApp(null, { url: options.url ?? '/login' })
  await unmount()
  const tree = (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </RouterContextProvider>
  )
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree)
  document.body.append(container)
  onTestFinished(() => container.remove())
  const mismatches: Array<unknown> = []
  const hydrate = () => {
    const root = hydrateRoot(container, tree, { onRecoverableError: (error) => mismatches.push(error) })
    onTestFinished(() => root.unmount())
  }
  return {
    container,
    form: () => container.querySelector('form')!,
    hydrate,
    mismatches,
    screen: page.elementLocator(container),
  }
}

export const formOf = (button: ReturnType<typeof page.getByRole>) =>
  page.elementLocator(button.element().closest('form')!)

export async function expectFieldIssue(
  field: ReturnType<typeof page.getByRole>,
  message: string,
  button: ReturnType<typeof page.getByRole>,
) {
  await expect.element(page.getByRole('alert')).toHaveTextContent(message)
  await expect.element(field).toHaveAttribute('aria-invalid', 'true')
  await expect.element(field).toHaveAccessibleDescription(new RegExp(`${message.replaceAll('.', String.raw`\.`)}$`))
  await expect.element(field).toHaveFocus()
  await expect.element(formOf(button)).not.toHaveAttribute('aria-describedby')
}

export const statusText = (title: string) => page.getByRole('status', { name: title }).getByRole('paragraph')

export async function expectFocusedStatus(title: string) {
  const status = page.getByRole('status', { name: title })
  await expect.element(status).toHaveFocus()
  expect(document.activeElement).toBe(status.element())
}

export const afterRendering = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

export async function pressAndKeepFocus(button: ReturnType<typeof page.getByRole>) {
  ;(button.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(button).toHaveAttribute('aria-disabled', 'true')
  await afterRendering()
  await expect.element(button).toHaveFocus()
}
