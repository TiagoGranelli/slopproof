import { dropTestDatabase, resetTestDatabase, testDatabaseUrl } from '../../scripts/test-db.ts'

export default async function setup() {
  const url = testDatabaseUrl('db')
  await resetTestDatabase(url)
  process.env.DATABASE_URL = url
  return async () => {
    if (process.env.KEEP_TEST_DB !== '1') {
      await dropTestDatabase(url)
    }
  }
}
