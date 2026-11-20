import { type InfiniteData, InfiniteQueryObserver, MutationObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '#/lib/query-client.ts'

const setup = async () => {
  const events: Array<string> = []
  const queryClient = createQueryClient()
  const list = (name: string) => ({
    getNextPageParam: (_: string, pages: Array<string>) => pages.length,
    initialPageParam: 0,
    queryFn: ({ pageParam }: { pageParam: number }) => {
      events.push(`fetch ${name} ${pageParam}`)
      return Promise.resolve(`${name} page ${pageParam}`)
    },
    queryKey: [name],
  })
  for (const name of ['public', 'mine', 'other']) {
    await queryClient.infiniteQuery(list(name))
    queryClient.setQueryData<InfiniteData<string, number>>([name], {
      pageParams: [0, 1, 2],
      pages: [0, 1, 2].map((n) => `${name} page ${n}`),
    })
  }
  const unsubscribe = new InfiniteQueryObserver(queryClient, { ...list('mine'), staleTime: Infinity }).subscribe(
    () => {},
  )
  events.length = 0
  const pages = (name: string) => queryClient.getQueryData<InfiniteData<string>>([name])?.pages
  return { events, pages, queryClient, unsubscribe }
}

describe('createQueryClient', () => {
  it('refetches what a mutation invalidates after its onSuccess, before it resolves', async () => {
    const { events, pages, queryClient, unsubscribe } = await setup()
    const mutation = new MutationObserver(queryClient, {
      meta: {
        invalidates: [
          { firstPageOnly: true, inactiveToo: true, queryKey: ['public'] },
          { queryKey: ['mine'] },
          { queryKey: ['other'] },
        ],
      },
      mutationFn: () => Promise.resolve('saved'),
      onSuccess: () => void events.push('caller onSuccess'),
    })
    await mutation.mutate(undefined)
    events.push('resolved')

    expect(events).toEqual([
      'caller onSuccess',
      'fetch public 0',
      'fetch mine 0',
      'fetch mine 1',
      'fetch mine 2',
      'resolved',
    ])
    expect(pages('public')).toEqual(['public page 0'])
    expect(pages('mine')).toHaveLength(3)
    expect(queryClient.getQueryState(['other'])?.isInvalidated).toBe(true)
    unsubscribe()
  })

  it('invalidates after a failure only when the mutation says the failure means stale data', async () => {
    const { queryClient, unsubscribe } = await setup()
    const failing = (message: string) =>
      new MutationObserver(queryClient, {
        meta: {
          invalidates: [{ queryKey: ['other'] }],
          invalidatesOnError: (error) => error instanceof Error && error.message === 'gone',
        },
        mutationFn: () => Promise.reject(new Error(message)),
      })
    await expect(failing('offline').mutate(undefined)).rejects.toThrow('offline')
    expect(queryClient.getQueryState(['other'])?.isInvalidated).toBe(false)
    await expect(failing('gone').mutate(undefined)).rejects.toThrow('gone')
    expect(queryClient.getQueryState(['other'])?.isInvalidated).toBe(true)
    unsubscribe()
  })

  it('clears the cache before the caller onSuccess, runs onClear, and leaves it alone without meta', async () => {
    const { events, pages, queryClient, unsubscribe } = await setup()
    await new MutationObserver(queryClient, { mutationFn: () => Promise.resolve(null) }).mutate(undefined)
    expect(pages('mine')).toHaveLength(3)

    let cleared = 0
    const tracked = createQueryClient({}, { onClear: () => (cleared += 1) })
    tracked.setQueryData(['mine'], 'kept')
    const seen: Array<unknown> = []
    await new MutationObserver(tracked, {
      meta: { clearsCache: true },
      mutationFn: () => Promise.resolve(null),
      onSuccess: () => void seen.push([tracked.getQueryData(['mine']), cleared]),
    }).mutate(undefined)
    expect(seen).toEqual([[undefined, 1]])
    expect(events).toEqual([])
    unsubscribe()
  })
})
