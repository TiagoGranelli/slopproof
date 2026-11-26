import { definePlugin } from 'nitro'
import type { NitroRuntimeHooks } from 'nitro/types'
import { env } from '../env.ts'
import { setFeatureFlagOverrides } from '../feature-flags.ts'
import { runShutdown, setDraining } from '../lifecycle.ts'
import { log } from '../log.ts'
import { reportCapturedError } from '../observability/error-reporter.ts'
import type { ErrorReportContext } from '../observability/error-reporter.ts'

const errorTagsFor = (
  method: string | undefined,
  path: string | undefined,
): NonNullable<ErrorReportContext['tags']> => {
  const entries: Array<[string, string]> = [['source', 'nitro']]
  if (method) {
    entries.push(['method', method])
  }
  if (path) {
    entries.push(['path', path])
  }
  return Object.fromEntries(entries)
}

const onError: NitroRuntimeHooks['error'] = (error, { event, tags = [] }) => {
  const path = event ? new URL(event.req.url).pathname : undefined
  reportCapturedError(error, { tags: errorTagsFor(event?.req.method, path) })
  if (tags.includes('uncaughtException')) {
    log('error', 'uncaught exception, exiting', { error })
    process.exit(1)
  }
  if (tags.includes('unhandledRejection')) {
    log('error', 'unhandled rejection', { error })
    return
  }
  log('error', 'request error', { error, method: event?.req.method, path, tags })
}

export default definePlugin((nitroApp) => {
  setFeatureFlagOverrides(env.featureFlags)
  log('info', 'starting', {
    appUrl: env.appUrl,
    databasePoolMax: env.databasePoolMax,
    databaseUrlPooled: env.databaseUrlPooled,
    permissionModel: process.execArgv.includes('--permission'),
    trustedProxies: env.trustedProxies,
  })

  nitroApp.hooks.hook('close', runShutdown)

  if (!process.env.CI && !process.env.TEST) {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        setDraining(true)
        log('info', 'draining', { signal })
      })
    }
  }

  nitroApp.hooks.hook('error', onError)
})
