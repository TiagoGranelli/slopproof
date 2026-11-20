import { createFileRoute } from '@tanstack/react-router'
import { apiHandler } from '#/server/api/web-handler.ts'

export const Route = createFileRoute('/api/$')({
  server: { handlers: { ANY: ({ request }) => apiHandler(request) } },
})
