import { startTestServers } from '../../scripts/test-servers.ts'

export default async function globalSetup() {
  const { servers, stop } = await startTestServers('e2e')
  Object.assign(process.env, servers.env, {
    CLOSED_APP_URL: servers.closedAppUrl,
    MAILPIT_URL: servers.mailpitUrl,
  })
  return stop
}
