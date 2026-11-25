import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ProcessOutput = { output: string; status: number }

export const captureProcess = (command: string, args: Array<string>, env?: NodeJS.ProcessEnv): Promise<ProcessOutput> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.once('error', (error) => resolve({ output: `${command} did not start: ${error.message}\n`, status: 1 }))
    child.once('exit', (code) => resolve({ output, status: code ?? 1 }))
  })

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
