import { onTestFinished, vi } from 'vitest'
import type { Json } from '#/contract/json.ts'

type LogLine = Readonly<Record<string, Json>>

export const captureLog = (): Array<LogLine> => {
  const lines: Array<LogLine> = []
  const capture = (chunk: string | Uint8Array) => {
    lines.push(JSON.parse(String(chunk)) as LogLine)
    return true
  }
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture)
  onTestFinished(() => {
    stdout.mockRestore()
    stderr.mockRestore()
  })
  return lines
}

export const stubEnvironment = (values: Record<string, string | undefined>): void => {
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value)
  }
  onTestFinished(() => {
    vi.unstubAllEnvs()
  })
}
