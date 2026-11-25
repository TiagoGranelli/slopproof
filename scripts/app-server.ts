import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { assertFreshBuild } from './build-freshness.ts'
import { edgePeers, startEdge } from './edge.ts'
import type { RunningEdge } from './edge.ts'
import { captureProcess } from './process-log.ts'
import { spawnServer, waitForServer } from './server-process.ts'
import type { ServerProcess } from './server-process.ts'
import { resetTestDatabase } from './test-db.ts'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

type User = { email: string; name: string; password: string }

export type RunningApp = {
  databaseUrl: string
  directUrl: string
  edgeCertificateSpki?: string
  env: NodeJS.ProcessEnv
  logFile: string
  otherUser: User
  stop: ServerProcess['stop']
  url: string
  user: User
}

export const LOOPBACK = '127.0.0.1/32,::1/128'

const password = () => `pw-${crypto.randomUUID()}`

const freePort = () =>
  new Promise<string>((resolve, reject) => {
    const probe = createServer().once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(String(port)))
    })
  })

const runQuiet = async (command: string, args: Array<string>, env: NodeJS.ProcessEnv) => {
  const { output, status } = await captureProcess(command, args, env)
  if (status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${status}, expected 0)\n${output.trim()}`)
  }
}

type EdgeOptions = {
  logFile: string
  tls?: boolean
  trustedProxies?: string
}

type StartAppOptions = {
  alongside?: RunningApp
  databaseUrl: string
  edge?: EdgeOptions
  logFile: string
  settings?: NodeJS.ProcessEnv
  trustedProxies?: string
}

const accounts = (alongside: RunningApp | undefined) => ({
  otherUser: alongside?.otherUser ?? { email: 'other@example.test', name: 'Other Author', password: password() },
  user: alongside?.user ?? { email: 'author@example.test', name: 'Test Author', password: password() },
})

const seedDatabase = async (databaseUrl: string, env: NodeJS.ProcessEnv, users: Array<User>) => {
  await resetTestDatabase(databaseUrl)
  await Promise.all(
    users.map((u) =>
      runQuiet('node', ['scripts/create-user.ts', u.email, u.name], { ...env, CREATE_USER_PASSWORD: u.password }),
    ),
  )
}

type Ports = { app: string; directUrl: string; edge?: string; url: string }

const choosePorts = async (edge: EdgeOptions | undefined): Promise<Ports> => {
  const app = await freePort()
  const directUrl = `http://localhost:${app}`
  if (!edge) {
    return { app, directUrl, url: directUrl }
  }
  const port = await freePort()
  return { app, directUrl, edge: port, url: `${edge.tls ? 'https' : 'http'}://localhost:${port}` }
}

const serverEnv = (options: StartAppOptions, ports: Ports): NodeJS.ProcessEnv => ({
  ...process.env,
  APP_URL: ports.url,
  BETTER_AUTH_SECRET:
    options.alongside?.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || crypto.randomUUID().repeat(2),
  DATABASE_URL: options.databaseUrl,
  NODE_ENV: 'production',
  PORT: ports.app,
  TRUSTED_PROXIES: options.edge ? edgePeers() : (options.trustedProxies ?? ''),
  ...options.settings,
})

const startEdgeInFront = async (edge: EdgeOptions, ports: Ports & { edge: string }): Promise<RunningEdge> =>
  startEdge({
    logFile: edge.logFile,
    port: ports.edge,
    tls: edge.tls ? { httpPort: await freePort() } : undefined,
    trustedProxies: edge.trustedProxies,
    upstreamPort: ports.app,
  })

const startServing = async (options: StartAppOptions, ports: Ports, server: ServerProcess) => {
  let edge: RunningEdge | undefined
  const stop = async () => {
    await edge?.stop()
    return server.stop()
  }
  try {
    await waitForServer(server.child, ports.directUrl, options.logFile)
    if (options.edge && ports.edge) {
      edge = await startEdgeInFront(options.edge, { ...ports, edge: ports.edge })
    }
  } catch (error) {
    await stop()
    throw error
  }
  return { edgeCertificateSpki: edge?.certificateSpki, stop }
}

export const startApp = async (options: StartAppOptions): Promise<RunningApp> => {
  assertFreshBuild()
  const ports = await choosePorts(options.edge)
  const { otherUser, user } = accounts(options.alongside)
  const env = serverEnv(options, ports)
  if (!options.alongside) {
    await seedDatabase(options.databaseUrl, env, [user, otherUser])
  }
  const { edgeCertificateSpki, stop } = await startServing(options, ports, spawnServer(env, options.logFile))
  const { directUrl, url } = ports
  const { databaseUrl, logFile } = options
  return { databaseUrl, directUrl, edgeCertificateSpki, env, logFile, otherUser, stop, url, user }
}
