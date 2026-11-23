import { infiniteQueryOptions, useSuspenseInfiniteQuery } from '@tanstack/react-query'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LoadMoreList } from '#/components/lists/load-more-list.tsx'
import { firstPage, nextPage } from '#/lib/infinite-pages.ts'
import { listPage, listPages } from './api-mocks.ts'
import { renderInApp, testQueryClient } from './test-utils.tsx'

type Note = { id: string; text: string }
type NotePage = { items: Array<Note>; nextCursor: string | null }

const makePage = (prefix: string, size: number, cursor: string | null): NotePage =>
  listPage(
    Array.from({ length: size }, (_, index) => ({ id: `${prefix}-${index}`, text: `${prefix}-${index}` })),
    cursor,
  )

interface RenderedListModel {
  cursors: Array<string>
  exhausted: boolean
  needsRefresh: boolean
  pageCount: number
  texts: Array<string>
}

interface RenderedListReal {
  cursors: Array<string>
  pagesByCursor: Map<string, NotePage>
}

const loadMoreButton = () => page.getByRole('button', { name: /^(?:Load(?:ing)? more|Refreshing) notes/ })
const listItems = () => page.getByRole('listitem')
const itemTexts = () =>
  listItems()
    .elements()
    .map((entry) => entry.textContent)

const recordPageRequest = (model: RenderedListModel) => {
  if (model.needsRefresh) {
    model.cursors.push('', ...Array.from({ length: model.pageCount - 1 }, (_, index) => `cursor-${index + 1}`))
  }
  const nextCursor = `cursor-${model.pageCount}`
  model.cursors.push(nextCursor)
  return nextCursor
}

const runLoadPage = async (
  model: RenderedListModel,
  real: RenderedListReal,
  next: { readonly added: number; readonly hasMore: boolean },
) => {
  const previousCount = model.texts.length
  const nextCursor = recordPageRequest(model)
  const pageIndex = ++model.pageCount
  const appended = makePage(`p${pageIndex}`, next.added, next.hasMore ? `cursor-${pageIndex}` : null)
  real.pagesByCursor.set(nextCursor, appended)
  model.texts.push(...appended.items.map((entry) => entry.text))
  await loadMoreButton().click()
  await expect.poll(itemTexts).toEqual(model.texts)
  await expect.element(listItems().nth(previousCount)).toHaveFocus()
  model.exhausted = !next.hasMore
  model.needsRefresh = false
  expect(real.cursors).toEqual(model.cursors)
  if (model.exhausted) {
    await expect.element(loadMoreButton()).not.toBeInTheDocument()
  }
}

const runFailPage = async (model: RenderedListModel, real: RenderedListReal) => {
  recordPageRequest(model)
  model.needsRefresh = true
  await loadMoreButton().click()
  await expect.element(page.getByRole('alert')).toBeVisible()
  await expect.element(loadMoreButton()).toHaveFocus()
  expect(itemTexts()).toEqual(model.texts)
  expect(real.cursors).toEqual(model.cursors)
}

const loadPageCommand = (added: number, hasMore: boolean): fc.AsyncCommand<RenderedListModel, RenderedListReal> => ({
  check: (model) => !model.exhausted,
  run: (model, real) => runLoadPage(model, real, { added, hasMore }),
  toString: () => `load(added=${added}, more=${String(hasMore)})`,
})

const failPageCommand: fc.AsyncCommand<RenderedListModel, RenderedListReal> = {
  check: (model) => !model.exhausted,
  run: (model, real) => runFailPage(model, real),
  toString: () => 'load(fail)',
}

function PropertyNotes(props: { source: (cursor: string) => Promise<NotePage> }) {
  const options = infiniteQueryOptions({
    getNextPageParam: nextPage,
    initialPageParam: firstPage,
    queryFn: ({ pageParam }) => props.source(typeof pageParam === 'string' ? pageParam : ''),
    queryKey: ['property-notes'],
  })
  const pages = useSuspenseInfiniteQuery(options)
  return (
    <LoadMoreList
      empty="No notes yet."
      noun="notes"
      pages={pages}
      queryKey={options.queryKey}
      renderItem={(entry) => <p>{entry.text}</p>}
      testId="property-notes"
    />
  )
}

const listCommands = fc.commands(
  [
    fc.tuple(fc.integer({ max: 3, min: 1 }), fc.boolean()).map(([added, more]) => loadPageCommand(added, more)),
    fc.constant(failPageCommand),
  ],
  { maxCommands: 8 },
)

const renderPropertyList = async (first: NotePage, real: RenderedListReal) => {
  const queryClient = testQueryClient()
  queryClient.setQueryData(['property-notes'], listPages(first))
  const fetchPage = (cursor: string) => {
    real.cursors.push(cursor)
    const requested = real.pagesByCursor.get(cursor)
    return requested ? Promise.resolve(requested) : Promise.reject(new TypeError('Failed to fetch'))
  }
  return renderInApp(<PropertyNotes source={fetchPage} />, { queryClient })
}

describe('LoadMoreList property-based UI invariants', () => {
  it('preserves item order and focus across arbitrary page fetches, failures and refresh-first retries', async () => {
    await fc.assert(
      fc.asyncProperty(listCommands, async (commands) => {
        const first = makePage('p1', 2, 'cursor-1')
        const real: RenderedListReal = { cursors: [], pagesByCursor: new Map([['', first]]) }
        const model: RenderedListModel = {
          cursors: [],
          exhausted: false,
          needsRefresh: false,
          pageCount: 1,
          texts: first.items.map((entry) => entry.text),
        }
        const rendered = await renderPropertyList(first, real)
        await fc.asyncModelRun(() => ({ model, real }), commands)
        expect(real.cursors).toEqual(model.cursors)
        await rendered.unmount()
      }),
      { numRuns: 15 },
    )
  })
})
