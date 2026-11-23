import { spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { readRootCertificate, servedCertificateSpki, trustCertificateAuthority } from './edge-certificate.ts'
import { dockerPrefix, IMAGES } from './images.ts'
import { spawnToLog } from './process-log.ts'
import { answersReady } from './server-process.ts'

export type RunningEdge = {
  certificateSpki?: string
  stop: () => Promise<void>
  url: string
}

const CADDYFILE = resolve('deploy/Caddyfile')

type EdgeEnv = Record<'EDGE_ADDRESS' | 'EDGE_UPSTREAM' | 'EDGE_TRUSTED_PROXIES' | 'EDGE_HTTP_PORT', string>

const LOOPBACK = '127.0.0.1/32,::1/128'
type Reach = 'host' | 'bridge'

const reach = (): Reach => {
  if ((process.env.EDGE_RUNTIME ?? 'docker') !== 'docker') {
    return 'host'
  }
  const network = process.env.EDGE_DOCKER_NETWORK || (process.platform === 'linux' ? 'host' : 'bridge')
  if (network !== 'host' && network !== 'bridge') {
    throw new Error(`EDGE_DOCKER_NETWORK must be host or bridge, not "${network}"`)
  }
  return network
}

export const edgePeers = (): string =>
  reach() === 'host' ? LOOPBACK : `${LOOPBACK},10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`

type EdgeOptions = {
  logFile: string
  port: string
  tls?: { httpPort: string }
  trustedProxies?: string
  upstreamPort: string
}

const edgeEnv = (options: EdgeOptions): EdgeEnv => ({
  EDGE_ADDRESS: options.tls ? `https://localhost:${options.port}` : `:${options.port}`,
  EDGE_HTTP_PORT: options.tls?.httpPort ?? '80',
  EDGE_TRUSTED_PROXIES: options.trustedProxies ?? '',
  EDGE_UPSTREAM: `${reach() === 'host' ? '127.0.0.1' : 'host.docker.internal'}:${options.upstreamPort}`,
})

const publish = (port: string) => [
  '--publish',
  `127.0.0.1:${port}:${port}`,
  '--publish',
  `127.0.0.1:${port}:${port}/udp`,
]

const containerNetwork = (ports: Array<string>): Array<string> => {
  if (reach() === 'host') {
    return ['--network', 'host']
  }
  return ['--add-host', 'host.docker.internal:host-gateway', ...ports.flatMap((port) => publish(port))]
}

type CaddyContainer = { env: EdgeEnv; name: string; ports: Array<string> }

const dockerRunCaddy = ({ env, name, ports }: CaddyContainer): Array<string> => {
  if (spawnSync('docker', ['image', 'inspect', IMAGES.caddy], { stdio: 'ignore' }).status !== 0) {
    spawnSync('docker', ['pull', '--quiet', IMAGES.caddy], { stdio: 'inherit' })
  }
  const sandbox = ['--memory', '256m', '--read-only', '--tmpfs', '/data', '--tmpfs', '/config']
  const envNames = Object.keys(env).flatMap((key) => ['--env', key])
  const caddyfile = ['--volume', `${CADDYFILE}:/etc/caddy/Caddyfile:ro`]
  const caddy = ['caddy', 'run', '--adapter', 'caddyfile', '--config', '/etc/caddy/Caddyfile']
  return ['run', '--rm', '--name', name, ...containerNetwork(ports), ...sandbox, ...envNames, ...caddyfile].concat([
    IMAGES.caddy,
    ...caddy,
  ])
}

type EdgeCommand = { args: Array<string>; command: string }

const edgeCommand = (runtime: string, container: CaddyContainer): EdgeCommand => {
  if (runtime === 'binary') {
    return { args: ['run', '--adapter', 'caddyfile', '--config', CADDYFILE], command: process.env.CADDY_BIN || 'caddy' }
  }
  if (runtime !== 'docker') {
    throw new Error(`EDGE_RUNTIME must be docker or binary, not "${runtime}"`)
  }
  return { args: dockerRunCaddy(container), command: 'docker' }
}

const stopEdge = async (child: ChildProcess, container: string | undefined, exited: Promise<void>) => {
  if (container) {
    spawnSync('docker', ['stop', '--timeout', '5', container], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
  const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
  await exited.finally(() => clearTimeout(killer))
}

const childExit = (child: ChildProcess) =>
  new Promise<void>((done) => {
    child.once('exit', () => done())
  })

const edgeStopper = (child: ChildProcess, container: string | undefined, dataHome: string | undefined) => {
  const exited = childExit(child)
  const cleanUp = () => {
    if (container) {
      spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
    }
    if (dataHome) {
      rmSync(dataHome, { force: true, recursive: true })
    }
  }
  process.once('exit', cleanUp)
  return async () => {
    if (child.exitCode === null && child.signalCode === null) {
      await stopEdge(child, container, exited)
    }
    cleanUp()
    process.off('exit', cleanUp)
  }
}

type LaunchedEdge = {
  certificateSpki: (() => Promise<string>) | undefined
  child: ChildProcess
  command: string
  logFile: string
  stop: () => Promise<void>
  url: string
}

const binaryDirectories = (dataHome: string | undefined) =>
  dataHome ? { XDG_CONFIG_HOME: join(dataHome, 'config'), XDG_DATA_HOME: join(dataHome, 'data') } : {}

const trustedCertificateSpki = async (name: string, dataHome: string | undefined, port: string) => {
  trustCertificateAuthority(readRootCertificate(name, dataHome))
  return servedCertificateSpki(port)
}

const launchEdge = (options: EdgeOptions): LaunchedEdge => {
  const runtime = process.env.EDGE_RUNTIME ?? 'docker'
  const name = `${dockerPrefix()}-edge-${process.pid}-${options.port}`
  const env = edgeEnv(options)
  const ports = [options.port, ...(options.tls ? [options.tls.httpPort] : [])]
  const { args, command } = edgeCommand(runtime, { env, name, ports })
  const dataHome = runtime === 'binary' ? mkdtempSync(join(tmpdir(), 'edge-')) : undefined
  const childEnv = { ...process.env, ...env, ...binaryDirectories(dataHome) }
  const child = spawnToLog(command, args, { env: childEnv, logFile: options.logFile })
  child.once('error', () => {})
  return {
    certificateSpki: options.tls ? () => trustedCertificateSpki(name, dataHome, options.port) : undefined,
    child,
    command,
    logFile: options.logFile,
    stop: edgeStopper(child, runtime === 'docker' ? name : undefined, dataHome),
    url: options.tls ? `https://localhost:${options.port}` : `http://localhost:${options.port}`,
  }
}

type EdgePoll = { certificateSpki: string | undefined; ready: boolean }

const pollEdge = async (edge: LaunchedEdge, known: string | undefined): Promise<EdgePoll> => {
  const certificateSpki = known ?? (await edge.certificateSpki?.().catch(() => undefined))
  if (edge.certificateSpki && !certificateSpki) {
    return { certificateSpki, ready: false }
  }
  return { certificateSpki, ready: await answersReady(edge.url) }
}

const waitForEdge = async (edge: LaunchedEdge): Promise<EdgePoll> => {
  let poll: EdgePoll = { certificateSpki: undefined, ready: false }
  for (let attempt = 0; attempt < 120; attempt++) {
    const exit = edge.child.exitCode ?? edge.child.signalCode
    if (exit !== null) {
      throw new Error(`the edge (${edge.command}) exited with ${exit}; see ${edge.logFile}`)
    }
    poll = await pollEdge(edge, poll.certificateSpki)
    if (poll.ready) {
      return poll
    }
    await delay(250)
  }
  return poll
}

export const startEdge = async (options: EdgeOptions): Promise<RunningEdge> => {
  const edge = launchEdge(options)
  const { certificateSpki, ready } = await waitForEdge(edge)
  if (ready) {
    return { certificateSpki, stop: edge.stop, url: edge.url }
  }
  await edge.stop()
  throw new Error(`the edge did not answer ${edge.url}/api/ready within 30 s; see ${options.logFile}`)
}
