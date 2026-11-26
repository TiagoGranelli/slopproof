import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, test as setup } from '@playwright/test'
import { Client } from 'pg'
import { createAuthor, nextClientIp, PAGINATED_AUTHOR, signIn } from './support/app.ts'

const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

const INSERT_POSTS = `
  insert into "post" ("author_id", "body", "created_at", "updated_at")
  select
    $1,
    body,
    now() - ($3::int - ord + 1) * interval '1 second',
    now() - ($3::int - ord + 1) * interval '1 second'
  from unnest($2::text[]) with ordinality as rows(body, ord)
`

const seedPaginatedPosts = async (databaseUrl: string, authorId: string, bodies: ReadonlyArray<string>) => {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const query = await client.query(INSERT_POSTS, [authorId, [...bodies], bodies.length])
    return query.rowCount
  } finally {
    await client.end()
  }
}

setup('an author with more posts than fit on one page', async ({ playwright }, testInfo) => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set for E2E seeding')
  }
  const author = await createAuthor('Paginated E2E Author')
  const inserted = await seedPaginatedPosts(databaseUrl, author.id, PAGINATED_AUTHOR.bodies)
  expect(inserted).toBe(PAGINATED_AUTHOR.bodies.length)
  const request = await playwright.request.newContext({
    baseURL: appUrl,
    extraHTTPHeaders: { origin: appUrl, 'x-forwarded-for': nextClientIp(testInfo.workerIndex) },
  })
  try {
    await signIn(request, author)
    const path = PAGINATED_AUTHOR.storageState(testInfo)
    mkdirSync(dirname(path), { recursive: true })
    await request.storageState({ path })
  } finally {
    await request.dispose()
  }
})
