import { drizzle } from 'drizzle-orm/node-postgres'
import { Effect, Layer } from 'effect'
import { Client } from 'pg'
import { expect, vi } from 'vitest'
import { UserId } from '#/contract/ids.ts'
import { auth } from '#/server/auth.ts'
import { Database, pool } from '#/server/db/client.ts'
import * as schema from '#/server/db/schema/index.ts'

const textOf = (query: unknown) =>
  typeof query === 'string' ? query : String((query as { text?: unknown } | null)?.text ?? query)

export async function statementsOf<A>(work: () => Promise<A>): Promise<{ returned: A; statements: Array<string> }> {
  const spy = vi.spyOn(Client.prototype, 'query')
  try {
    const returned = await work()
    return { returned, statements: spy.mock.calls.map(([query]) => textOf(query)) }
  } finally {
    spy.mockRestore()
  }
}

export const expectBudget = (what: string, statements: Array<string>, budget: number) => {
  expect(
    statements,
    `${what} issued ${statements.length} SQL statements, its budget is ${budget}:\n${statements.join('\n')}`,
  ).toHaveLength(budget)
}

const logged: Array<string> = []
export const recordingDb = drizzle({ client: pool, logger: { logQuery: (query) => void logged.push(query) }, schema })
export const recordingDatabase = Layer.succeed(Database, recordingDb)

export const withBudget = async <A, E>(what: string, budget: number, effect: Effect.Effect<A, E>) => {
  logged.length = 0
  const value = await Effect.runPromise(effect)
  expectBudget(what, [...logged], budget)
  return value
}

export const createAccount = async (label: string) => {
  const context = await auth.$context
  const password = `pw-${crypto.randomUUID()}`
  const created = await context.internalAdapter.createUser(
    { email: `${label}-${crypto.randomUUID()}@example.test`, emailVerified: true, name: `DB ${label}` },
    { method: 'email-password' },
  )
  await context.internalAdapter.linkAccount({
    accountId: created.id,
    password: await context.password.hash(password),
    providerId: 'credential',
    userId: created.id,
  })
  return { email: created.email, id: UserId.make(created.id), name: created.name, password }
}
