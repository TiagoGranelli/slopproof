import type { InfiniteData } from '@tanstack/react-query'
import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw'
import { setupWorker } from 'msw/browser'
import type { AuthOutcome } from '#/lib/auth.functions.ts'
import { createMswHandlers, type MswHandlerFactories } from '#/sdk/msw.gen.ts'
import type {
  MeGetErrors,
  MyPostsCreateErrors,
  MyPostsListErrors,
  MyPostsRemoveErrors,
  MyPostsUpdateErrors,
  Post,
  PublicPostsListErrors,
  SystemReadyErrors,
} from '#/sdk/types.gen.ts'
import { type AuthFunctionName, authFunctionPath } from './stubs/auth-functions.ts'

export const worker = setupWorker()

export const api = createMswHandlers().pick

type ErrorsByOperation = {
  meGet: MeGetErrors
  myPostsCreate: MyPostsCreateErrors
  myPostsList: MyPostsListErrors
  myPostsRemove: MyPostsRemoveErrors
  myPostsUpdate: MyPostsUpdateErrors
  publicPostsList: PublicPostsListErrors
  systemReady: SystemReadyErrors
}

export const apiError = <Op extends keyof ErrorsByOperation, Status extends keyof ErrorsByOperation[Op] & number>(
  operation: Op,
  status: Status,
  body: ErrorsByOperation[Op][Status],
): HttpHandler => api[operation](() => HttpResponse.json(body as JsonBodyType, { status }))

export const apiFailure = (
  operation: keyof MswHandlerFactories,
  failure: { network: true } | { status: number; text: string },
): HttpHandler =>
  api[operation](() =>
    'network' in failure
      ? HttpResponse.error()
      : new HttpResponse(failure.text, { headers: { 'content-type': 'text/plain' }, status: failure.status }),
  )

const pendingReleases = new Set<() => void>()

export const held = () => {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  pendingReleases.add(release)
  return { release, wait: () => released }
}

export const releaseHeld = (): void => {
  for (const release of pendingReleases) {
    release()
  }
  pendingReleases.clear()
}

export const post = (overrides: Partial<Post> = {}): Post => ({
  authorName: 'Test Author',
  body: 'A post',
  createdAt: '2026-01-02T03:04:05.000Z',
  id: crypto.randomUUID(),
  updatedAt: '2026-01-02T03:04:05.000Z',
  ...overrides,
})

export const listPage = <Item>(items: Array<Item>, nextCursor: string | null = null) => ({ items, nextCursor })

export const listPages = <Page extends { nextCursor: string | null }>(...pages: Array<Page>): InfiniteData<Page> => ({
  pageParams: pages.map((_, index) => (index === 0 ? {} : pages[index - 1]!.nextCursor)),
  pages,
})

type ImmediateAuthAnswer<T> = AuthOutcome<T> | 'network' | 'thrown'
type AuthAnswer<T> = ImmediateAuthAnswer<T> | { answer?: ImmediateAuthAnswer<T>; wait: () => Promise<void> }

const respond = (answer: ImmediateAuthAnswer<unknown>) => {
  if (answer === 'network') {
    return HttpResponse.error()
  }
  if (answer === 'thrown') {
    return HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
  }
  return HttpResponse.json(answer as JsonBodyType)
}

export const authFunction = <T = null>(name: AuthFunctionName, answer: AuthAnswer<T>): HttpHandler =>
  http.post(`*${authFunctionPath(name)}`, async () => {
    if (typeof answer === 'object' && 'wait' in answer) {
      await answer.wait()
      return respond(answer.answer ?? ({ ok: true, value: null } satisfies AuthOutcome))
    }
    return respond(answer)
  })

export const authCalls = (name: AuthFunctionName) => {
  const data: Array<unknown> = []
  const handler = http.post(`*${authFunctionPath(name)}`, async ({ request }) => {
    data.push(await request.clone().json())
  })
  return { data, handler }
}

type PassedThrough = 'network' | { wait: () => Promise<void> }

const signInAnswer = (outcome: 'ok' | 'invalid' | PassedThrough): AuthAnswer<null> => {
  if (outcome === 'ok') {
    return { ok: true, value: null }
  }
  if (outcome === 'invalid') {
    return { failure: { code: 'INVALID_EMAIL_OR_PASSWORD' }, ok: false }
  }
  return outcome
}

const signOutAnswer = (outcome: 'ok' | 'failed' | PassedThrough): AuthAnswer<null> => {
  if (outcome === 'ok') {
    return { ok: true, value: null }
  }
  if (outcome === 'failed') {
    return 'thrown'
  }
  return outcome
}

export const auth = {
  signIn: (outcome: Parameters<typeof signInAnswer>[0]) => authFunction('signIn', signInAnswer(outcome)),
  signOut: (outcome: Parameters<typeof signOutAnswer>[0]) => authFunction('signOut', signOutAnswer(outcome)),
}
