import '@tanstack/react-start/server-only'
import { onShutdown } from './lifecycle.ts'
import { log } from './log.ts'

const pending = new Set<Promise<void>>()

const track = (settled: Promise<void>) => {
  const tracked: Promise<void> = settled.finally(() => pending.delete(tracked))
  pending.add(tracked)
}

export const runInBackground = (task: Promise<unknown>): void => {
  track(task.then(() => undefined).catch((error: unknown) => log('error', 'background task failed', { error })))
}

export const finishBeforeShutdown = <A>(work: Promise<A>): Promise<A> => {
  track(work.then(() => undefined).catch(() => undefined))
  return work
}

const drainBackgroundTasks = async (): Promise<void> => {
  if (pending.size === 0) {
    return
  }
  await Promise.all(pending)
  return drainBackgroundTasks()
}

onShutdown('background-tasks', drainBackgroundTasks)
