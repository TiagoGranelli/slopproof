import { infiniteQueryOptions, useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LoadMoreList } from '#/components/lists/load-more-list.tsx'
import { firstPage, nextPage } from '#/lib/infinite-pages.ts'
import { held, listPage, listPages } from './api-mocks.ts'
import { pressAndKeepFocus, renderInApp, testQueryClient } from './test-utils.tsx'

type Note = { id: string; text: string }
type NotePage = { items: Array<Note>; nextCursor: string | null }

const note = (text: string): Note => ({ id: crypto.randomUUID(), text })
const CURSOR = 'cursor-after-page-1'
const first = listPage([note('newest'), note('newer')], CURSOR)
const second = listPage([note('older'), note('oldest')])

type Source = (cursor: string) => Promise<NotePage>

const notesQuery = (source: Source) =>
  infiniteQueryOptions({
    getNextPageParam: nextPage,
    initialPageParam: firstPage,
    queryFn: ({ pageParam }) => source(typeof pageParam === 'string' ? pageParam : ''),
    queryKey: ['notes'],
  })

function Notes(props: { source: Source }) {
  const pages = useSuspenseInfiniteQuery(notesQuery(props.source))
  return (
    <LoadMoreList
      empty="No notes yet."
      noun="notes"
      pages={pages}
      renderItem={(shown) => <p>{shown.text}</p>}
      testId="notes"
    />
  )
}

const renderNotes = async (seeded: NotePage, answer: () => Promise<NotePage>) => {
  const cursors: Array<string> = []
  const queryClient = testQueryClient()
  const source: Source = (cursor) => {
    cursors.push(cursor)
    return answer()
  }
  queryClient.setQueryData(notesQuery(source).queryKey, listPages(seeded))
  await renderInApp(<Notes source={source} />, { queryClient })
  return cursors
}

const loadMore = () => page.getByRole('button', { name: /^Load(ing)? more notes/ })
const items = () => page.getByRole('listitem')

describe('LoadMoreList', () => {
  it('shows the empty message in place of the list', async () => {
    await renderNotes(listPage([]), () => Promise.resolve(second))
    await expect.element(page.getByTestId('notes')).toHaveTextContent('No notes yet.')
    await expect.element(page.getByRole('list')).not.toBeInTheDocument()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('loads the next page with the cursor, busy meanwhile, then focuses its first item', async () => {
    const response = held()
    const cursors = await renderNotes(first, async () => {
      await response.wait()
      return second
    })
    await pressAndKeepFocus(loadMore())
    await expect.element(loadMore()).toHaveTextContent('Loading more notes…')
    await userEvent.keyboard('{Enter}')
    expect(cursors).toEqual([CURSOR])

    response.release()
    await expect.element(items().nth(2)).toHaveTextContent('older')
    await expect.element(items().nth(2)).toHaveFocus()
    await expect.element(loadMore()).not.toBeInTheDocument()
    expect(cursors).toEqual([CURSOR])
  })

  it('reports a failure, keeps the loaded items and focus, and retries', async () => {
    let fail = true
    const cursors = await renderNotes(first, () =>
      fail ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(second),
    )
    await loadMore().click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not load more notes. Check your connection and try again.')
    await expect.element(loadMore()).toHaveFocus()
    expect(items().elements()).toHaveLength(2)

    fail = false
    await loadMore().click()
    await expect.element(items().nth(2)).toHaveFocus()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    expect(cursors).toEqual([CURSOR, CURSOR])
  })
})
