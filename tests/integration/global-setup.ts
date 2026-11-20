import type { TestProject } from 'vitest/node'
import { startTestServers, type TestServers } from '../../scripts/test-servers.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    servers: TestServers
  }
}

export default async function setup(project: TestProject) {
  const { servers, stop } = await startTestServers('integration')
  project.provide('servers', servers)
  return stop
}
