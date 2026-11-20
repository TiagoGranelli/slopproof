import { createServerOnlyFn } from '@tanstack/react-start'
import { env } from '#/server/env.ts'

export const appOrigin = createServerOnlyFn(() => env.appUrl)
