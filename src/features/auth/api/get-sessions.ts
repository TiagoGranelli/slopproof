import { queryOptions } from '@tanstack/react-query'
import { listSessions } from '#/lib/auth.functions.ts'

export const sessionsQueryKey = ['auth', 'sessions'] as const

export const getSessionsQueryOptions = () => queryOptions({ queryFn: () => listSessions(), queryKey: sessionsQueryKey })
