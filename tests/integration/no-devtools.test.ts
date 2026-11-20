import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DEVTOOLS_EVENT_CLIENT = /tanstack-connect-success|tanstack-dispatch-event/

const scriptsUnder = (dir: string): Array<string> =>
  readdirSync(dir, { encoding: 'utf8', recursive: true })
    .filter((file) => /\.m?js$/.test(file))
    .map((file) => join(dir, file))

it('ships no devtools event client to the browser or in the server', () => {
  const scripts = [...scriptsUnder('.output/public'), ...scriptsUnder('.output/server')]
  expect(scripts.length).toBeGreaterThan(0)
  expect(scripts.filter((file) => DEVTOOLS_EVENT_CLIENT.test(readFileSync(file, 'utf8')))).toEqual([])
})
