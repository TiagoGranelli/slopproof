import { describe, expect, it } from 'vitest'
import { type AuditItem, type Lhr, preloadTaskMs } from '../../scripts/lighthouse-runs.ts'

const report = (requests: Array<AuditItem>, tasks: Array<AuditItem>): Lhr => ({
  audits: {
    'main-thread-tasks': { details: { items: tasks }, score: null, scoreDisplayMode: 'informative', title: '' },
    'network-requests': { details: { items: requests }, score: null, scoreDisplayMode: 'informative', title: '' },
  },
  categories: {},
  environment: { benchmarkIndex: 2258 },
  finalDisplayedUrl: 'https://localhost/',
  runWarnings: [],
})

const documentRequest = { rendererStartTime: 0, resourceType: 'Document' }
const stylesheet = { rendererStartTime: 61.9, resourceType: 'Stylesheet' }
const tasks = [
  { duration: 31.9, startTime: 45.5 },
  { duration: 10.1, startTime: 137 },
]

describe('preloadTaskMs', () => {
  it('is the duration of the task during which the first stylesheet or script was requested', () => {
    expect(preloadTaskMs(report([documentRequest, stylesheet], tasks))).toBe(31.9)
  })

  it('also finds a script requested first', () => {
    const script = { rendererStartTime: 140, resourceType: 'Script' }
    expect(preloadTaskMs(report([documentRequest, script], tasks))).toBe(10.1)
  })

  it('is null when no subresource was requested or no task contains the request', () => {
    expect(preloadTaskMs(report([documentRequest], tasks))).toBeNull()
    expect(preloadTaskMs(report([documentRequest, { ...stylesheet, rendererStartTime: 100 }], tasks))).toBeNull()
    expect(preloadTaskMs(report([documentRequest, { resourceType: 'Stylesheet' }], tasks))).toBeNull()
  })
})
