import '@tanstack/react-start/server-only'
import { log } from './log.ts'

type Cleanup = () => Promise<void> | void

const STEPS = ['auth-cleanup', 'background-tasks', 'mailer', 'effect-api', 'postgres-pool'] as const
export type ShutdownStep = (typeof STEPS)[number]

const REGISTRY = Symbol.for('app.shutdown')
const DRAINING = Symbol.for('app.draining')
const shared = globalThis as { [DRAINING]?: boolean; [REGISTRY]?: Map<ShutdownStep, Cleanup> }
const registry = (shared[REGISTRY] ??= new Map<ShutdownStep, Cleanup>())

export const isDraining = (): boolean => shared[DRAINING] === true
export const setDraining = (draining: boolean): void => {
  shared[DRAINING] = draining
}

export const onShutdown = (step: ShutdownStep, cleanup: Cleanup): void => {
  registry.set(step, cleanup)
}

const runStep = async (step: ShutdownStep, cleanup: Cleanup): Promise<number> => {
  const started = performance.now()
  try {
    await cleanup()
  } catch (error) {
    log('error', 'shutdown cleanup failed', { cleanup: step, error })
  }
  return Math.round(performance.now() - started)
}

export const runShutdown = async (): Promise<void> => {
  const started = performance.now()
  const ran: Array<{ ms: number; step: ShutdownStep }> = []
  for (const step of STEPS) {
    const cleanup = registry.get(step)
    if (!cleanup) {
      continue
    }
    registry.delete(step)
    // One step at a time on purpose: each one may still need what the later ones release.
    // oxlint-disable-next-line no-await-in-loop
    ran.push({ ms: await runStep(step, cleanup), step })
  }
  log('info', 'shutdown complete', {
    cleanups: ran.map(({ step }) => step),
    ms: Math.round(performance.now() - started),
    steps: ran,
  })
}
