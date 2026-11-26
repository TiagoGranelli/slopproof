import { stderr, stdin } from 'node:process'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import * as schema from '#/server/db/schema/index.ts'

export type NewVerifiedUser = {
  databaseUrl: string
  email: string
  name: string
  password: string
}

export type CreatedUser = {
  email: string
  id: string
  name: string
}

const DEFAULT_AUTH_SECRET = 'create-user-in-process-placeholder-000'

const validatePassword = (password: string) => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`password too short (${password.length} characters): use at least ${PASSWORD_MIN_LENGTH}`)
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`password too long (${password.length} characters): use at most ${PASSWORD_MAX_LENGTH}`)
  }
}

type CreateUserDb = ReturnType<typeof drizzle<typeof schema>>
type AccountInput = { email: string; name: string; password: string }

const assertUniqueEmail = async (db: CreateUserDb, email: string) => {
  const [existing] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email))
  if (existing) {
    throw new Error(`a user with email ${email} already exists`)
  }
}

const createAuth = (db: CreateUserDb) =>
  betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    secret: process.env.BETTER_AUTH_SECRET || DEFAULT_AUTH_SECRET,
  })

const insertVerifiedUser = async (db: CreateUserDb, account: AccountInput): Promise<CreatedUser> => {
  await assertUniqueEmail(db, account.email)
  const context = await createAuth(db).$context
  const hash = await context.password.hash(account.password)
  const created = await context.internalAdapter.createUser(
    { email: account.email, emailVerified: true, name: account.name },
    { method: 'email-password' },
  )
  await context.internalAdapter.linkAccount({
    accountId: created.id,
    password: hash,
    providerId: 'credential',
    userId: created.id,
  })
  return { email: created.email, id: created.id, name: created.name }
}

export const createVerifiedUser = async (input: NewVerifiedUser): Promise<CreatedUser> => {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  validatePassword(input.password)
  const pool = new Pool({
    application_name: 'app-create-user',
    connectionString: input.databaseUrl,
    connectionTimeoutMillis: 5000,
    max: 1,
  })
  try {
    return await insertVerifiedUser(drizzle({ client: pool, schema }), { email, name, password: input.password })
  } finally {
    await pool.end()
  }
}

const mutableEcho = () => {
  let muted = false
  const output = new Writable({
    write(chunk: Buffer | string, encoding: BufferEncoding, callback) {
      if (!muted) {
        stderr.write(chunk, encoding)
      }
      callback()
    },
  })
  return { mute: () => (muted = true), output }
}

const askHidden = (question: string) =>
  new Promise<string>((resolve, reject) => {
    const echo = mutableEcho()
    const rl = createInterface({ historySize: 0, input: stdin, output: echo.output, terminal: true })
    rl.on('SIGINT', () => {
      rl.close()
      stderr.write('\n')
      reject(new Error('cancelled at the password prompt (Ctrl-C)'))
    })
    rl.question(question, (answer) => {
      rl.close()
      stderr.write('\n')
      resolve(answer)
    })
    echo.mute()
  })

const readPassword = async () => {
  if (process.env.CREATE_USER_PASSWORD) {
    return process.env.CREATE_USER_PASSWORD
  }
  if (stdin.isTTY) {
    const password = await askHidden('Password: ')
    if ((await askHidden('Repeat password: ')) !== password) {
      throw new Error('the passwords do not match')
    }
    return password
  }
  let data = ''
  for await (const chunk of stdin) {
    data += chunk
  }
  return data.replace(/\r?\n$/, '')
}

const parseCliArgs = () => {
  const [rawEmail, rawName] = process.argv.slice(2)
  const email = rawEmail?.trim().toLowerCase()
  const name = rawName?.trim()
  if (!email || !name) {
    console.error(
      'usage: pnpm user:create <email> <name>, or in the image: node .output/create-user.mjs <email> <name>\n' +
        '(password via stdin or CREATE_USER_PASSWORD)',
    )
    process.exit(2)
  }
  return { email, name }
}

const runCli = async () => {
  const { email, name } = parseCliArgs()
  try {
    const databaseUrl = process.env.DATABASE_URL?.trim()
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required')
    }
    const password = await readPassword()
    const created = await createVerifiedUser({ databaseUrl, email, name, password })
    console.log(`created ${created.email}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (import.meta.main) {
  await runCli()
}
