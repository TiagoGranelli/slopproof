import { stdin, stderr } from 'node:process'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { auth } from '#/server/auth.ts'
import { db, pool } from '#/server/db/client.ts'
import { user } from '#/server/db/schema/index.ts'

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

try {
  const password = await readPassword()
  const { maxPasswordLength, minPasswordLength } = auth.options.emailAndPassword
  if (password.length < minPasswordLength) {
    throw new Error(`password too short (${password.length} characters): use at least ${minPasswordLength}`)
  }
  if (password.length > maxPasswordLength) {
    throw new Error(`password too long (${password.length} characters): use at most ${maxPasswordLength}`)
  }
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  if (existing) {
    throw new Error(`a user with email ${email} already exists`)
  }
  const context = await auth.$context
  const hash = await context.password.hash(password)
  const created = await context.internalAdapter.createUser(
    { email, emailVerified: true, name },
    { method: 'email-password' },
  )
  await context.internalAdapter.linkAccount({
    accountId: created.id,
    password: hash,
    providerId: 'credential',
    userId: created.id,
  })
  console.log(`created ${created.email}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool.end()
}
