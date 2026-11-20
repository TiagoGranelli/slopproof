import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { clientIps, signIn, sharedUsers } from './helpers.ts'

const ASSETS = '.output/public/assets'

const EFFECT_RUNTIME = /~effect\/[A-Z]/
const EFFECT_HTTP = /~effect\/https?(api)?\//

const read = (file: string) => readFileSync(join(ASSETS, file), 'utf8')

const scriptsOf = async (path: string, cookie?: string) => {
  const response = await fetch(new URL(path, process.env.APP_URL), { headers: cookie ? { cookie } : {} })
  expect(new URL(response.url).pathname, `${path} redirected`).toBe(new URL(path, 'http://x').pathname)
  const html = await response.text()
  return [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]!)
}

const PUBLIC_PAGES = [
  '/',
  '/about',
  '/login',
  '/sign-up',
  '/forgot-password',
  '/reset-password?token=t',
  '/verify-email',
]
const SIGNED_IN_PAGES = ['/dashboard', '/account']
const nextIp = clientIps('100.64.9')

describe('client bundle', () => {
  const scripts = readdirSync(ASSETS).filter((file) => file.endsWith('.js'))

  it('has client scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0)
  })

  it('contains no HttpApi or HTTP code of Effect in any client chunk', () => {
    expect(scripts.filter((file) => EFFECT_HTTP.test(read(file)))).toEqual([])
  })

  it.each(PUBLIC_PAGES)('loads and preloads no Effect runtime on %s before an interaction', async (path) => {
    const loaded = await scriptsOf(path)
    expect(loaded.length).toBeGreaterThan(0)
    expect(loaded.filter((file) => EFFECT_RUNTIME.test(read(file)))).toEqual([])
  })

  describe('signed in', () => {
    let cookie: string
    beforeAll(async () => {
      cookie = await signIn(sharedUsers.author, nextIp())
    })

    it.each(SIGNED_IN_PAGES)('loads and preloads no Effect runtime on %s before an interaction', async (path) => {
      const loaded = await scriptsOf(path, cookie)
      expect(loaded.length).toBeGreaterThan(0)
      expect(loaded.filter((file) => EFFECT_RUNTIME.test(read(file)))).toEqual([])
    })
  })

  it('recognizes the Effect runtime where it does belong: the lazy form chunk and the server build', () => {
    expect(scripts.some((file) => EFFECT_RUNTIME.test(read(file)))).toBe(true)
    const server = '.output/server'
    const modules = readdirSync(server, { encoding: 'utf8', recursive: true }).filter((file) => file.endsWith('.mjs'))
    expect(modules.some((file) => EFFECT_RUNTIME.test(readFileSync(join(server, file), 'utf8')))).toBe(true)
    expect(modules.some((file) => EFFECT_HTTP.test(readFileSync(join(server, file), 'utf8')))).toBe(true)
  })
})
