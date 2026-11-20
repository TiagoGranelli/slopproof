import { definePlugin } from 'nitro'
import type { NitroRuntimeHooks } from 'nitro/types'
import { env } from '../env.ts'
import { runShutdown, setDraining } from '../lifecycle.ts'
import { log } from '../log.ts'

const onError: NitroRuntimeHooks['error'] = (error, { event, tags = [] }) => {
  if (tags.includes('uncaughtException')) {
    log('error', 'uncaught exception, exiting', { error })
    process.exit(1)
  }
  if (tags.includes('unhandledRejection')) {
    log('error', 'unhandled rejection', { error })
    return
  }
  log('error', 'request error', {
    error,
    method: event?.req.method,
    path: event ? new URL(event.req.url).pathname : undefined,
    tags,
  })
}

export default definePlugin((nitroApp) => {
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
