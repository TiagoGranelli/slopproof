import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, test as setup } from '@playwright/test'
import { createAuthor, nextClientIp, PAGINATED_AUTHOR, signIn } from './support/app.ts'

const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

setup('an author with more posts than fit on one page', async ({ playwright }, testInfo) => {
  const author = await createAuthor('Paginated E2E Author')
  const request = await playwright.request.newContext({
    baseURL: appUrl,
    extraHTTPHeaders: { origin: appUrl, 'x-forwarded-for': nextClientIp(testInfo.workerIndex) },
  })
  try {
    await signIn(request, author)
    for (const body of PAGINATED_AUTHOR.bodies) {
      expect((await request.post('/api/me/posts', { data: { body } })).status()).toBe(201)
    }
    const path = PAGINATED_AUTHOR.storageState(testInfo)
    mkdirSync(dirname(path), { recursive: true })
    await request.storageState({ path })
  } finally {
    await request.dispose()
  }
})
