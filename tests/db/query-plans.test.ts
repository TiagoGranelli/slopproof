import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserId } from '#/contract/ids.ts'
import type { PageCursor } from '#/contract/pages.ts'
import { postgresRateLimitStorage } from '#/server/auth-rate-limit.ts'
import { Database, db, pool } from '#/server/db/client.ts'
import { rateLimit } from '#/server/db/schema/index.ts'
import { PostsRepo } from '#/server/posts/repo.ts'
import { createAccount } from './helpers.ts'

interface CapturedQuery {
  readonly text: string
  readonly values: Array<unknown>
}

interface PlanNode {
  readonly 'Conflict Arbiter Indexes'?: Array<string>
  readonly 'Index Name'?: string
  readonly 'Node Type': string
  readonly Plans?: Array<PlanNode>
  readonly 'Relation Name'?: string
}

const INDEX_NODE_TYPES = new Set(['Bitmap Index Scan', 'Index Only Scan', 'Index Scan'])
const POST_COUNT = 10_000
const RATE_LIMIT_COUNT = 2000
const EXTRA_AUTHORS = 19
const PREFIX = `plan-${crypto.randomUUID()}`

const repoLayer = PostsRepo.layer.pipe(Layer.provide(Database.layer))

const toCaptured = (raw: unknown, args: Array<unknown>): CapturedQuery | undefined => {
  if (typeof raw === 'string') {
    return { text: raw, values: Array.isArray(args[0]) ? (args[0] as Array<unknown>) : [] }
  }
  const config = raw as { text?: unknown; values?: unknown } | null
  if (config && typeof config.text === 'string') {
    const rawValues = config.values ?? args[0]
    return { text: config.text, values: Array.isArray(rawValues) ? (rawValues as Array<unknown>) : [] }
  }
  return undefined
}

const captureStatements = async <A>(work: () => Promise<A>): Promise<{ outcome: A; queries: Array<CapturedQuery> }> => {
  const spy = vi.spyOn(Client.prototype, 'query')
  try {
    const outcome = await work()
    const queries = spy.mock.calls.flatMap(([first, ...rest]) => {
      const captured = toCaptured(first, rest)
      return captured ? [captured] : []
    })
    return { outcome, queries }
  } finally {
    spy.mockRestore()
  }
}

const collectNodes = (root: PlanNode): Array<PlanNode> => [
  root,
  ...(root.Plans ?? []).flatMap((child) => collectNodes(child)),
]

const explainNodes = async (captured: CapturedQuery): Promise<Array<PlanNode>> => {
  const { rows } = await pool.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
    `EXPLAIN (FORMAT JSON) ${captured.text}`,
    captured.values,
  )
  const root = rows[0]?.['QUERY PLAN'][0]?.Plan
  if (!root) {
    throw new Error(`EXPLAIN returned no plan for: ${captured.text}`)
  }
  return collectNodes(root)
}

const expectIndexPlan = (nodes: Array<PlanNode>, relation: string, expectedIndex: string) => {
  const seqScans = nodes.filter((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === relation)
  const indexScans = nodes.filter(
    (node) => INDEX_NODE_TYPES.has(node['Node Type']) && node['Relation Name'] === relation,
  )
  expect(seqScans, `unexpected Seq Scan on ${relation}: ${JSON.stringify(nodes)}`).toEqual([])
  expect(indexScans.length, `expected index scan on ${relation}: ${JSON.stringify(nodes)}`).toBeGreaterThan(0)
  expect(indexScans.map((node) => node['Index Name'])).toContain(expectedIndex)
}

const runRepo = <A, E>(call: (repo: typeof PostsRepo.Service) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* call(yield* PostsRepo)
    }).pipe(Effect.provide(repoLayer)),
  )

let primaryAuthor: { id: UserId; name: string }
let seededUserIds: Array<string> = []
let sampleRateKey = ''

beforeAll(async () => {
  primaryAuthor = await createAccount('query-plan')
  const extraIds = Array.from({ length: EXTRA_AUTHORS }, (_, index) => `${PREFIX}-author-${index}`)
  seededUserIds = [primaryAuthor.id, ...extraIds]
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
       select id, 'Author ' || ordinality, id || '@example.test', true
       from unnest($1::text[]) with ordinality as u(id, ordinality)`,
    [extraIds],
  )
  await pool.query(
    `insert into post (author_id, body, created_at, updated_at)
       select ($1::text[])[(n % $2) + 1],
              'Synthetic post number ' || n,
              timestamptz '2020-01-01T00:00:00Z' + make_interval(secs => n),
              timestamptz '2020-01-01T00:00:00Z' + make_interval(secs => n)
       from generate_series(1, $3) as g(n)`,
    [seededUserIds, seededUserIds.length, POST_COUNT],
  )
  const now = Date.now()
  await pool.query(
    `insert into rate_limit (key, count, last_request)
       select $1 || '|' || n, 1, $2
       from generate_series(1, $3) as g(n)`,
    [PREFIX, now, RATE_LIMIT_COUNT],
  )
  sampleRateKey = `${PREFIX}|1000`
  await pool.query('ANALYZE post')
  await pool.query('ANALYZE "user"')
  await pool.query('ANALYZE rate_limit')
})

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await pool.query('delete from "user" where id = any($1::text[])', [seededUserIds])
  }
  await pool.query('delete from rate_limit where key like $1', [`${PREFIX}|%`])
  await pool.end()
})

describe('PostgreSQL query plans over 10,000 posts and 2,000 rate_limit rows', () => {
  it('uses post_keyset_idx without Seq Scan for listPublic first page and cursor page', async () => {
    const first = await captureStatements(() => runRepo((repo) => repo.listPublic({ limit: 20 })))
    const cursor: PageCursor | undefined = first.outcome.nextCursor ?? undefined
    expect(cursor).toBeDefined()
    const next = await captureStatements(() => runRepo((repo) => repo.listPublic({ cursor, limit: 20 })))
    expect(first.queries).toHaveLength(1)
    expect(next.queries).toHaveLength(1)
    expectIndexPlan(await explainNodes(first.queries[0]!), 'post', 'post_keyset_idx')
    expectIndexPlan(await explainNodes(next.queries[0]!), 'post', 'post_keyset_idx')
  })

  it('uses post_author_keyset_idx without Seq Scan for listByAuthor first page and cursor page', async () => {
    const first = await captureStatements(() => runRepo((repo) => repo.listByAuthor(primaryAuthor, { limit: 20 })))
    const cursor: PageCursor | undefined = first.outcome.nextCursor ?? undefined
    expect(cursor).toBeDefined()
    const next = await captureStatements(() =>
      runRepo((repo) => repo.listByAuthor(primaryAuthor, { cursor, limit: 20 })),
    )
    expect(first.queries).toHaveLength(1)
    expect(next.queries).toHaveLength(1)
    expectIndexPlan(await explainNodes(first.queries[0]!), 'post', 'post_author_keyset_idx')
    expectIndexPlan(await explainNodes(next.queries[0]!), 'post', 'post_author_keyset_idx')
  })

  it('uses rate_limit_pkey without Seq Scan for rate_limit lookup and upsert', async () => {
    const lookup = await captureStatements(() => db.select().from(rateLimit).where(eq(rateLimit.key, sampleRateKey)))
    expect(lookup.queries).toHaveLength(1)
    expectIndexPlan(await explainNodes(lookup.queries[0]!), 'rate_limit', 'rate_limit_pkey')

    const upsert = await captureStatements(() =>
      postgresRateLimitStorage.consume(sampleRateKey, { max: 60, window: 60 }),
    )
    const insertQuery = upsert.queries.find((query) => query.text.toLowerCase().includes('insert into "rate_limit"'))
    expect(insertQuery).toBeDefined()
    const upsertNodes = await explainNodes(insertQuery!)
    const seqScans = upsertNodes.filter(
      (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'rate_limit',
    )
    const usesPrimaryKey = upsertNodes.some(
      (node) =>
        (INDEX_NODE_TYPES.has(node['Node Type']) && node['Index Name'] === 'rate_limit_pkey') ||
        Boolean(node['Conflict Arbiter Indexes']?.includes('rate_limit_pkey')),
    )
    expect(seqScans).toEqual([])
    expect(usesPrimaryKey, JSON.stringify(upsertNodes)).toBe(true)
  })
})
