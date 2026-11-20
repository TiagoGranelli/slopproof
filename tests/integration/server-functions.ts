import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import type * as AuthFunctions from '#/lib/auth.functions.ts'
import { appUrl } from './helpers.ts'

type Json = null | undefined | boolean | number | string | Array<Json> | { [key: string]: Json }
type Value = null | undefined | boolean | number | string | Error | Array<Value> | { [key: string]: Value }
type Node =
  | { s: number; t: 0 }
  | { s: string; t: 1 }
  | { s: 0 | 1 | 2 | 3; t: 2 }
  | { a: Array<Node>; i: number; o: 0; t: 9 }
  | { i: number; o: 0; p: { k: Array<string>; v: Array<Node> }; t: 10 | 11 }
  | { c: string; s: { message: Node }; t: 25 }

const ESCAPED = /[\\"\n\r\b\t\f\u2028\u2029<]/
const plain = (text: string) => {
  if (ESCAPED.test(text)) {
    throw new Error(`server function values must be plain strings, got ${JSON.stringify(text)}`)
  }
  return text
}

const encode = (value: Json, ids: { next: number }): Node => {
  if (value === null) {
    return { s: 0, t: 2 }
  }
  if (value === undefined) {
    return { s: 1, t: 2 }
  }
  if (typeof value === 'boolean') {
    return { s: value ? 2 : 3, t: 2 }
  }
  if (typeof value === 'number') {
    return { s: value, t: 0 }
  }
  if (typeof value === 'string') {
    return { s: plain(value), t: 1 }
  }
  const i = ids.next++
  if (Array.isArray(value)) {
    return { a: value.map((element) => encode(element, ids)), i, o: 0, t: 9 }
  }
  const keys = Object.keys(value).map((key) => plain(key))
  return { i, o: 0, p: { k: keys, v: keys.map((key) => encode(value[key], ids)) }, t: 10 }
}

const decode = (node: Node): Value => {
  switch (node.t) {
    case 0:
      return node.s
    case 1:
      return plain(node.s)
    case 2:
      return [null, undefined, true, false][node.s]
    case 9:
      return node.a.map((element) => decode(element))
    case 10:
    case 11: {
      const { k, v } = node.p
      return Object.fromEntries(k.map((key, index) => [plain(key), decode(v[index]!)]))
    }
    case 25:
      if (node.c === '$TSR/Error') {
        const message = decode(node.s.message)
        return new Error(typeof message === 'string' ? message : JSON.stringify(message))
      }
      throw new Error(`unexpected Seroval plugin node ${JSON.stringify(node)}`)
    default:
      throw new Error(`unexpected Seroval node ${JSON.stringify(node)}`)
  }
}

const idOf = (name: string) =>
  createHash('sha256').update(`src/lib/auth.functions.ts--${name}_createServerFn_handler`).digest('hex')

type AuthFunction = keyof typeof AuthFunctions

export const authFunctionPath = (name: AuthFunction) => `/_serverFn/${idOf(name)}`
type Answer<F extends AuthFunction> = Awaited<ReturnType<(typeof AuthFunctions)[F]>>

type CallOptions = { baseUrl?: string; data?: Json; headers?: Record<string, string>; method?: 'GET' | 'POST' }

const serverFunctionRequest = (name: AuthFunction, options: CallOptions): Request => {
  const url = new URL(authFunctionPath(name), options.baseUrl ?? appUrl)
  const payload = JSON.stringify({ f: 127, m: [], t: encode({ data: options.data }, { next: 0 }) })
  const base = { origin: appUrl, 'x-tsr-serverFn': 'true' }
  if (options.method === 'GET') {
    url.searchParams.set('payload', payload)
    return new Request(url, { headers: { ...base, ...options.headers }, method: 'GET' })
  }
  const headers = { ...base, 'content-type': 'application/json', ...options.headers }
  return new Request(url, { body: payload, headers, method: 'POST' })
}

export const callAuthFunction = async <F extends AuthFunction>(
  name: F,
  options: CallOptions = {},
): Promise<{ response: Response; thrown?: string; value: Answer<F> | undefined }> => {
  const response = await fetch(serverFunctionRequest(name, options))
  const text = await response.clone().text()
  expect(text, `server function ${name} has id ${idOf(name)}`).not.toContain('"unhandled":true')
  const answer = response.headers.get('content-type')?.includes('json') ? decode(JSON.parse(text) as Node) : undefined
  if (answer instanceof Error) {
    return { response, thrown: answer.message, value: undefined }
  }
  const envelope = (answer ?? {}) as Partial<Record<'result' | 'error', Value>>
  if (envelope.error instanceof Error) {
    return { response, thrown: envelope.error.message, value: undefined }
  }
  return { response, value: envelope.result as Answer<F> | undefined }
}
