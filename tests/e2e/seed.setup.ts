import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, PAGINATED_AUTHOR, signIn, test as setup } from './support/app.ts'

setup('an author with more posts than fit on one page', async ({ author, request }, testInfo) => {
  await signIn(request, author)
  for (const body of PAGINATED_AUTHOR.bodies) {
    expect((await request.post('/api/me/posts', { data: { body } })).status()).toBe(201)
  }
  const path = PAGINATED_AUTHOR.storageState(testInfo)
  mkdirSync(dirname(path), { recursive: true })
  await request.storageState({ path })
})
