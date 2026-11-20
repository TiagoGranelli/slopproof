import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { myPostsCreate, myPostsList, myPostsRemove, publicPostsList } from '#/sdk/sdk.gen.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'
import { clientIps, createUser, sdkClient, signIn } from './helpers.ts'

const nextIp = clientIps('100.64.30')
const anonymous = sdkClient()
type Client = ReturnType<typeof sdkClient>
let author: Client
let other: Client
const created: Array<{ client: Client; id: string }> = []

let authorName: string
beforeAll(async () => {
  const [mine, theirs] = await Promise.all([createUser('pagination'), createUser('pagination-other')])
  authorName = mine.name
  author = sdkClient(await signIn(mine, nextIp()))
  other = sdkClient(await signIn(theirs, nextIp()))
})

afterAll(async () => {
  await Promise.all(created.map(({ client, id }) => myPostsRemove({ client, path: { id } })))
})

const tag = crypto.randomUUID().slice(0, 8)

const publish = async (client: Client, label: string, count: number) => {
  const posts: Array<Post> = []
  for (let i = 0; i < count; i++) {
    const res = await myPostsCreate({ body: { body: `pagination ${tag} ${label} ${i}` }, client })
    expect(res.response?.status).toBe(201)
    posts.push(res.data!)
    created.push({ client, id: res.data!.id })
  }
  return posts
}

type Query = { cursor?: string; limit?: string }
const publicPage = async (query: Query) => {
  const res = await publicPostsList({ client: anonymous, query })
  expect(res.response?.status, JSON.stringify(res.error)).toBe(200)
  return res.data!
}
const myPage = async (client: Client, query: Query) => {
  const res = await myPostsList({ client, query })
  expect(res.response?.status, JSON.stringify(res.error)).toBe(200)
  return res.data!
}

const walk = async (
  fetchPage: (query: Query) => Promise<PostPage>,
  limit: number,
  options: { between?: (page: number) => Promise<void>; done?: (seen: Array<Post>) => boolean } = {},
) => {
  const pages: Array<PostPage> = []
  let cursor: string | undefined
  for (let n = 0; n < 200; n++) {
    const page = await fetchPage(cursor ? { cursor, limit: String(limit) } : { limit: String(limit) })
    pages.push(page)
    const seen = pages.flatMap((p) => p.items)
    if (!page.nextCursor || options.done?.(seen)) {
      return pages
    }
    await options.between?.(n)
    cursor = page.nextCursor
  }
  throw new Error('the list did not end after 200 pages')
}

const expectPageSizes = (pages: Array<PostPage>, limit: number) => {
  for (const page of pages.slice(0, -1)) {
    expect(page.nextCursor).toEqual(expect.any(String))
    expect(page.items).toHaveLength(limit)
  }
  expect(pages.at(-1)!.items.length).toBeLessThanOrEqual(limit)
}

const expectNewestFirst = (posts: Array<Post>) => {
  const times = posts.map((p) => Date.parse(p.createdAt))
  expect(times).toEqual(times.toSorted((a, b) => b - a))
}

const ids = (posts: Array<Post>) => posts.map((p) => p.id)

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

const cursorAfter = async (count: number) => {
  let cursor: string | undefined
  for (let left = count; left > 0; left -= 50) {
    const page = await publicPage(
      cursor ? { cursor, limit: String(Math.min(left, 50)) } : { limit: String(Math.min(left, 50)) },
    )
    cursor = page.nextCursor ?? undefined
  }
  return cursor!
}

describe('limit', () => {
  it('defaults to 20 and accepts 1 to 50', async () => {
    await publish(author, 'limit', 2)
    const byDefault = await publicPage({})
    expect(byDefault.items.length).toBeLessThanOrEqual(20)
    for (const limit of [1, 2, 50]) {
      const page = await publicPage({ limit: String(limit) })
      expect(page.items.length).toBeLessThanOrEqual(limit)
      expect(page.items.length).toBeGreaterThanOrEqual(Math.min(limit, 2))
    }
    expect((await publicPage({ limit: '1' })).nextCursor).toEqual(expect.any(String))
  })

  it.each(['0', '51', '-1', '1.5', '1e1', ' 5', 'abc', ''])('rejects limit=%j with a 400', async (limit) => {
    for (const res of [
      await publicPostsList({ client: anonymous, query: { limit } }),
      await myPostsList({ client: author, query: { limit } }),
    ]) {
      expect(res.response?.status).toBe(400)
      expect(res.error).toMatchObject({ _tag: 'ValidationError', issues: [{ path: ['limit'] }] })
    }
  })
})

describe('cursor', () => {
  const validId = '00000000-0000-4000-8000-000000000000'

  it.each([
    ['not base64url', '!!!'],
    ['not JSON', 'garbage'],
    ['empty', ''],
    ['the wrong JSON shape', encode(['2026-01-01T00:00:00.000000Z', validId])],
    ['a missing id', encode({ createdAt: '2026-01-01T00:00:00.000000Z' })],
    ['an id that is not a UUID', encode({ createdAt: '2026-01-01T00:00:00.000000Z', id: "1' or '1'='1" })],
    ['millisecond precision', encode({ createdAt: '2026-01-01T00:00:00.000Z', id: validId })],
    ['a time zone offset', encode({ createdAt: '2026-01-01T00:00:00.000000+01:00', id: validId })],
    ['an impossible date', encode({ createdAt: '2026-02-30T00:00:00.000000Z', id: validId })],
    ['year 0, which Postgres rejects', encode({ createdAt: '0000-01-01T00:00:00.000000Z', id: validId })],
    ['SQL in the timestamp', encode({ createdAt: "now()'); drop table post; --", id: validId })],
    ['text after the Z', encode({ createdAt: '2026-01-01T00:00:00.000000Zjunk', id: validId })],
    ['month 13', encode({ createdAt: '2026-13-01T00:00:00.000000Z', id: validId })],
  ])('rejects a cursor with %s as a 400, never a 500', async (_, cursor) => {
    for (const res of [
      await publicPostsList({ client: anonymous, query: { cursor } }),
      await myPostsList({ client: author, query: { cursor } }),
    ]) {
      expect(res.response?.status).toBe(400)
      expect(res.error).toMatchObject({ _tag: 'ValidationError', message: 'Invalid request query' })
      const issues = (res.error as { issues: Array<{ path: Array<string> }> }).issues
      expect(issues.length).toBeGreaterThan(0)
      for (const issue of issues) {
        expect(issue.path[0]).toBe('cursor')
      }
    }
  })

  it.each([
    '0001-01-01T00:00:00.000000Z',
    '2026-10-31T23:59:59.999999Z',
    '2026-11-30T00:00:00.000001Z',
    '2026-12-31T12:00:00.500000Z',
    '2028-02-29T00:00:00.000000Z',
    '9999-12-31T23:59:59.999999Z',
  ])('answers a page for the valid key %s', async (createdAt) => {
    for (const id of [validId, 'FFFFFFFF-FFFF-8FFF-BFFF-FFFFFFFFFFFF']) {
      for (const res of [
        await publicPostsList({ client: anonymous, query: { cursor: encode({ createdAt, id }) } }),
        await myPostsList({ client: author, query: { cursor: encode({ createdAt, id }) } }),
      ]) {
        expect(res.response?.status, `${createdAt} ${id}: ${JSON.stringify(res.error)}`).toBe(200)
      }
    }
  })

  it('treats any well-formed key as a position, so edited cursors reveal nothing', async () => {
    const past = encode({ createdAt: '0001-01-01T00:00:00.000000Z', id: validId })
    expect(await publicPage({ cursor: past })).toEqual({ items: [], nextCursor: null })
    expect(await myPage(author, { cursor: past })).toEqual({ items: [], nextCursor: null })

    const theirs = await publish(other, 'future-key', 1)
    const future = encode({ createdAt: '9999-12-31T23:59:59.999999Z', id: validId })
    const mine = await myPage(author, { cursor: future, limit: '50' })
    expect(ids(mine.items)).not.toContain(theirs[0]!.id)
    expect(new Set(mine.items.map((p) => p.authorName))).toEqual(new Set([authorName]))
  })
})

describe('paging', () => {
  it('walks the public list newest first, without gaps or repeats, while posts are published', async () => {
    const seeded = await publish(author, 'walk', 7)
    const seededIds = new Set(ids(seeded))
    const lateIds = new Set<string>()
    const pages = await walk(publicPage, 3, {
      between: async () => {
        const [late] = await publish(other, 'during-walk', 1)
        lateIds.add(late!.id)
      },
      done: (seen) => [...seededIds].every((id) => ids(seen).includes(id)),
    })
    const seen = pages.flatMap((p) => p.items)
    expectPageSizes(pages, 3)
    expectNewestFirst(seen)
    expect(new Set(ids(seen)).size).toBe(seen.length)
    expect(ids(seen).filter((id) => seededIds.has(id))).toEqual(ids(seeded).toReversed())
    expect(ids(pages.slice(1).flatMap((p) => p.items)).filter((id) => lateIds.has(id))).toEqual([])
    expect(lateIds.size).toBeGreaterThan(0)
  })

  it('resumes strictly after the cursor, also for posts created in the same instant', async () => {
    const burst = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const res = await myPostsCreate({ body: { body: `pagination ${tag} burst ${i}` }, client: author })
        expect(res.response?.status).toBe(201)
        created.push({ client: author, id: res.data!.id })
        return res.data!
      }),
    )
    const burstIds = new Set(ids(burst))
    for (const limit of [1, 2, 4]) {
      const pages = await walk((query) => myPage(author, query), limit, {
        done: (seen) => [...burstIds].every((id) => ids(seen).includes(id)),
      })
      const seen = ids(pages.flatMap((p) => p.items))
      expectPageSizes(pages, limit)
      expect(new Set(seen).size).toBe(seen.length)
      expect(seen.filter((id) => burstIds.has(id)).toSorted()).toEqual([...burstIds].toSorted())
    }
  })

  it('ends with nextCursor null exactly when no post is left', async () => {
    await publish(author, 'end', 3)
    for (let attempt = 1; ; attempt++) {
      const pages = await walk(publicPage, 50)
      expectPageSizes(pages, 50)
      expect(pages.at(-1)!.nextCursor).toBeNull()
      const all = pages.flatMap((p) => p.items)
      const cursor = await cursorAfter(all.length - 3)
      const [exact, short] = await Promise.all([publicPage({ cursor, limit: '3' }), publicPage({ cursor, limit: '2' })])
      if (ids(exact.items).join() !== ids(all.slice(-3)).join() && attempt < 5) {
        continue
      }
      expect(exact).toEqual({ items: all.slice(-3), nextCursor: null })
      expect(short.items).toEqual(all.slice(-3, -1))
      expect(short.nextCursor).toEqual(expect.any(String))
      return
    }
  })
})

describe('author isolation across pages', () => {
  it("never pages into another author's posts", async () => {
    const mine = await publish(author, 'isolation-mine', 3)
    const theirs = await publish(other, 'isolation-theirs', 3)
    for (const [client, own, foreign] of [
      [author, mine, theirs],
      [other, theirs, mine],
    ] as const) {
      const ownIds = new Set(ids(own))
      const pages = await walk((query) => myPage(client, query), 2, {
        done: (seen) => [...ownIds].every((id) => ids(seen).includes(id)),
      })
      const seen = ids(pages.flatMap((p) => p.items))
      for (const post of foreign) {
        expect(seen).not.toContain(post.id)
      }
      expect(seen.filter((id) => ownIds.has(id))).toEqual(ids(own).toReversed())
    }

    const first = await myPage(author, { limit: '1' })
    const across = await myPage(other, { cursor: first.nextCursor!, limit: '50' })
    for (const post of mine) {
      expect(ids(across.items)).not.toContain(post.id)
    }
  })

  it('requires a session for the author list, whatever the query', async () => {
    const res = await myPostsList({ client: anonymous, query: { limit: '5' } })
    expect(res.response?.status).toBe(401)
    expect(res.error).toMatchObject({ _tag: 'Unauthorized' })
  })
})
