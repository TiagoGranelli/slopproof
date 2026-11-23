import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDraining, onShutdown, runShutdown, setDraining } from '#/server/lifecycle.ts'
import { captureLog } from './process-fakes.ts'

describe('runShutdown', () => {
  it('runs the steps one after another in their fixed order and logs that order', async () => {
    const lines = captureLog()
    const events: Array<string> = []
    const step = (name: string, ms: number) => async () => {
      events.push(`${name} start`)
      await delay(ms)
      events.push(`${name} end`)
    }
    onShutdown('postgres-pool', step('postgres-pool', 0))
    onShutdown('effect-api', step('effect-api', 0))
    onShutdown('mailer', step('mailer', 5))
    onShutdown('background-tasks', step('background-tasks', 10))
    onShutdown('auth-cleanup', step('auth-cleanup', 0))

    await runShutdown()

    expect(events).toEqual([
      'auth-cleanup start',
      'auth-cleanup end',
      'background-tasks start',
      'background-tasks end',
      'mailer start',
      'mailer end',
      'effect-api start',
      'effect-api end',
      'postgres-pool start',
      'postgres-pool end',
    ])
    expect(lines.at(-1)).toMatchObject({
      cleanups: ['auth-cleanup', 'background-tasks', 'mailer', 'effect-api', 'postgres-pool'],
      msg: 'shutdown complete',
    })
  })

  it('logs a failed step and still runs the later ones, once', async () => {
    const lines = captureLog()
    const pool = vi.fn<() => void>()
    onShutdown('mailer', () => {
      throw new Error('smtp gone')
    })
    onShutdown('postgres-pool', pool)

    await runShutdown()
    await runShutdown()

    expect(pool).toHaveBeenCalledOnce()
    expect(lines[0]).toMatchObject({ cleanup: 'mailer', level: 'error', msg: 'shutdown cleanup failed' })
    expect(lines[1]).toMatchObject({ cleanups: ['mailer', 'postgres-pool'], msg: 'shutdown complete' })
    expect(lines[2]).toMatchObject({ cleanups: [], msg: 'shutdown complete' })
  })
})

describe('draining', () => {
  afterEach(() => {
    setDraining(false)
  })

  it('is off until the signal handler turns it on, on the shared flag both bundle copies read', () => {
    expect(isDraining()).toBe(false)
    setDraining(true)
    expect(isDraining()).toBe(true)
    const DRAINING = Symbol.for('app.draining')
    expect((globalThis as { [DRAINING]?: boolean })[DRAINING]).toBe(true)
  })
})
