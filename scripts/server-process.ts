import type { ChildProcess } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnToLog, tail } from './process-log.ts'

export type ServerExit = { code: number | null; signal: NodeJS.Signals | null }

export type ServerProcess = {
  child: ChildProcess
  stop: () => Promise<ServerExit & { ms: number }>
}

const SERVER_FLAGS = [
  '--permission',
  `--allow-fs-read=${resolvePath('.output')}`,
  '--allow-net',
  '--disable-warning=ExperimentalWarning',
]

const stopper = (child: ChildProcess): ServerProcess['stop'] => {
  const exited = new Promise<ServerExit>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  return async () => {
    const started = performance.now()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await exited.finally(() => clearTimeout(killer))
    }
    return { ms: Math.round(performance.now() - started), ...(await exited) }
  }
}

export const spawnServer = (env: NodeJS.ProcessEnv, logFile: string): ServerProcess => {
  const { CI: _ci, TEST: _test, ...serverEnv } = env
  const child = spawnToLog(process.execPath, [...SERVER_FLAGS, '.output/server/index.mjs'], { env: serverEnv, logFile })
  return { child, stop: stopper(child) }
}

export const answersReady = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(`${url}/api/ready`)).ok
  } catch {
    return false
  }
}

export const waitForServer = async (server: ChildProcess, directUrl: string, logFile: string): Promise<void> => {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (server.exitCode !== null) {
      throw new Error(`server exited with ${server.exitCode}. Log (${logFile}):\n${tail(logFile)}`)
    }
    if (await answersReady(directUrl)) {
      return
    }
    await delay(50)
  }
  throw new Error(`server did not become ready in 30 s. Log (${logFile}):\n${tail(logFile)}`)
}
