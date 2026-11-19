import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

export default defineConfig({
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/server/db/schema/index.ts',
  strict: true,
  verbose: true,
})
