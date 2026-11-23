import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const spawnToLog = (
  command: string,
  args: Array<string>,
  options: { env: NodeJS.ProcessEnv; logFile: string },
): ChildProcess => {
  mkdirSync(dirname(options.logFile), { recursive: true })
  const log = openSync(options.logFile, 'w')
  const child = spawn(command, args, { env: options.env, stdio: ['ignore', log, log] })
  closeSync(log)
  return child
}

export const tail = (file: string, lines = 60): string =>
  existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n') : '(no log)'
