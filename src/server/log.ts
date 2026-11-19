import '@tanstack/react-start/server-only'

type Level = 'debug' | 'info' | 'warn' | 'error'
// A log line takes any value its caller has (thrown errors are `unknown`); JSON.stringify is the boundary.
// oxlint-disable-next-line quality/no-unsafe-dictionary-type
type Fields = Readonly<Record<string, unknown>>

// Only the first line of a message is kept and stacks are reduced to their frames: Drizzle and pg
// append the SQL parameters (emails, session tokens) on later lines.
const firstLine = (text: string) => text.split('\n', 1)[0] ?? ''
const frames = (stack: string | undefined) =>
  stack
    ?.split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n')

type SerializedError =
  | string
  | number
  | boolean
  | symbol
  | null
  | undefined
  | { readonly _tag: string | undefined; readonly type: string }
  | {
      readonly cause: SerializedError
      readonly code: string | number | undefined
      readonly message: string
      readonly name: string
      readonly stack: string | undefined
    }

/** An Error by message, name, code, stack frames and cause (three levels deep). */
const serializeErrorObject = (error: Error, depth: number): SerializedError => ({
  cause: error.cause !== undefined && depth < 3 ? serializeError(error.cause, depth + 1) : undefined,
  code: (error as { code?: string | number }).code,
  message: firstLine(error.message),
  name: error.name,
  stack: frames(error.stack),
})

type ThrownObject = { readonly _tag?: unknown; readonly constructor?: { readonly name: string } }

/**
 * Other thrown objects (Effect data classes, library error shapes) can hold request or response data in any field:
 * only what identifies them is kept. `Object.create(null)` objects have no constructor, whatever the lib types say.
 */
const summarizeObject = ({ _tag: tag, constructor }: ThrownObject): SerializedError => {
  return { _tag: typeof tag === 'string' ? tag : undefined, type: constructor?.name ?? 'Object' }
}

const serializeError = (error: unknown, depth = 0): SerializedError => {
  if (typeof error === 'string') {
    return firstLine(error)
  }
  if (typeof error === 'bigint' || typeof error === 'function') {
    return typeof error === 'bigint' ? String(error) : error.name
  }
  if (error === null || typeof error !== 'object') {
    return error as Exclude<SerializedError, object>
  }
  return error instanceof Error ? serializeErrorObject(error, depth) : summarizeObject(error)
}

/**
 * One JSON object per line on stdout (stderr for errors), for log collectors.
 * Never pass request headers, cookies, bodies or query strings: they can carry credentials.
 */
export const log = (level: Level, msg: string, fields: Fields = {}): void => {
  const { error, ...rest } = fields
  const entry = { level, msg, time: new Date().toISOString(), ...rest, error: serializeError(error) }
  const line = `${JSON.stringify(entry)}\n`
  if (level === 'error') {
    process.stderr.write(line)
  } else {
    process.stdout.write(line)
  }
}
