// Model-based browser property test (`fc.commands` / `fc.asyncModelRun`) driving the rendered LoadMoreList.
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
  exhausted: boolean
  itemCount: number
  requests: number
}

interface RenderedListReal {
  nextAnswer: () => Promise<NotePage>
  pageNumber: number
  requests: number
}

const loadMoreButton = () => page.getByRole('button', { name: /^Load(ing)? more notes/ })
const listItems = () => page.getByRole('listitem')

const runLoadPage = async (
  model: RenderedListModel,
  real: RenderedListReal,
  next: { readonly added: number; readonly hasMore: boolean },
) => {
  const previousCount = model.itemCount
  const pageIndex = ++real.pageNumber
  real.nextAnswer = () =>
    Promise.resolve(makePage(`p${pageIndex}`, next.added, next.hasMore ? `cursor-${pageIndex}` : null))
  await loadMoreButton().click()
  await expect.poll(() => listItems().elements().length).toBe(previousCount + next.added)
  await expect.element(listItems().nth(previousCount)).toHaveFocus()
  model.itemCount += next.added
  model.exhausted = !next.hasMore
  model.requests++
  expect(real.requests).toBe(model.requests)
  if (model.exhausted) {
    await expect.element(loadMoreButton()).not.toBeInTheDocument()
  }
}

const runFailPage = async (model: RenderedListModel, real: RenderedListReal) => {
  real.nextAnswer = () => Promise.reject(new TypeError('Failed to fetch'))
  await loadMoreButton().click()
  await expect.element(page.getByRole('alert')).toBeVisible()
  await expect.element(loadMoreButton()).toHaveFocus()
  expect(listItems().elements()).toHaveLength(model.itemCount)
  model.requests++
  expect(real.requests).toBe(model.requests)
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

function PropertyNotes(props: { source: () => Promise<NotePage> }) {
  const pages = useSuspenseInfiniteQuery(
    infiniteQueryOptions({
      getNextPageParam: nextPage,
      initialPageParam: firstPage,
      queryFn: () => props.source(),
      queryKey: ['property-notes'],
    }),
  )
  return (
    <LoadMoreList
      empty="No notes yet."
      noun="notes"
      pages={pages}
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
  { maxCommands: 5 },
)

describe('LoadMoreList property-based UI invariants', () => {
  it('focuses the first newly appended item, preserves items on error, and stops on exhaustion', async () => {
    await fc.assert(
      fc.asyncProperty(listCommands, async (commands) => {
        const real: RenderedListReal = {
          nextAnswer: () => Promise.resolve(makePage('fallback', 1, null)),
          pageNumber: 1,
          requests: 0,
        }
        const queryClient = testQueryClient()
        queryClient.setQueryData(['property-notes'], listPages(makePage('p1', 2, 'cursor-1')))
        const rendered = await renderInApp(
          <PropertyNotes
            source={() => {
              real.requests++
              return real.nextAnswer()
            }}
          />,
          { queryClient },
        )
        const model: RenderedListModel = { exhausted: false, itemCount: 2, requests: 0 }
        await fc.asyncModelRun(() => ({ model, real }), commands)
        expect(real.requests).toBe(model.requests)
        await rendered.unmount()
      }),
      { numRuns: 5 },
    )
  })
})
