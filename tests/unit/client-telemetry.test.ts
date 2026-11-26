import { afterEach, describe, expect, it, vi } from 'vitest'
import { initClientTelemetry, reportClientError } from '#/lib/client-telemetry.ts'
import type {
  ClientErrorPayload,
  ClientTelemetryOptions,
  WebVitalMetric,
  WebVitalName,
} from '#/lib/client-telemetry.ts'

interface FakeObserverInstance {
  readonly callback: (list: { getEntries: () => ReadonlyArray<PerformanceEntry> }) => void
  readonly disconnect: ReturnType<typeof vi.fn<() => void>>
  readonly observedTypes: Array<string>
}

interface FakeWindow {
  readonly addEventListener: (type: string, listener: (event: unknown) => void) => void
  readonly dispatch: (type: string, event: unknown) => void
  readonly listeners: Map<string, Set<(event: unknown) => void>>
  readonly removeEventListener: (type: string, listener: (event: unknown) => void) => void
}

const createFakeWindow = (): FakeWindow => {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event)
      }
    },
    listeners,
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
  }
}

const installBrowserGlobals = (options?: { readonly failEventType?: string; readonly sendBeacon?: boolean }) => {
  const fakeWindow = createFakeWindow()
  const instances: Array<FakeObserverInstance> = []
  const sendBeacon = vi.fn<(url: string, body: string) => boolean>().mockReturnValue(true)
  class FakePerformanceObserver {
    readonly #record: FakeObserverInstance
    constructor(callback: (list: { getEntries: () => ReadonlyArray<PerformanceEntry> }) => void) {
      this.#record = { callback, disconnect: vi.fn<() => void>(), observedTypes: [] }
      instances.push(this.#record)
    }
    observe(init: { readonly type: string }) {
      if (init.type === options?.failEventType) {
        throw new Error('unsupported')
      }
      this.#record.observedTypes.push(init.type)
    }
    disconnect() {
      this.#record.disconnect()
    }
  }
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
  vi.stubGlobal('navigator', options?.sendBeacon === false ? {} : { sendBeacon })
  return { fakeWindow, instances, sendBeacon }
}

describe('initClientTelemetry SSR and disabled guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a no-op cleanup in SSR and when disabled or given cross-origin endpoints', () => {
    const ssrCleanup = initClientTelemetry({ endpoint: '/api/rum' })
    ssrCleanup()
    const { fakeWindow, instances } = installBrowserGlobals()
    const disabledCleanup = initClientTelemetry({})
    const crossOriginCleanup = initClientTelemetry({ endpoint: 'https://evil.example/rum' })
    const protocolRelativeCleanup = initClientTelemetry({ endpoint: '//evil.example/rum' })
    disabledCleanup()
    crossOriginCleanup()
    protocolRelativeCleanup()
    expect(instances).toHaveLength(0)
    expect(fakeWindow.listeners.size).toBe(0)
  })
})

const fakeEntry = <T extends Record<string, boolean | number>>(fields: T): PerformanceEntry & T => ({
  duration: 0,
  entryType: 'test',
  name: 'test',
  startTime: 0,
  toJSON: () => ({}),
  ...fields,
})

describe('initClientTelemetry Web Vitals and error reporting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('observes LCP, CLS, and INP via PerformanceObserver, beacons same-origin, and cleans up', () => {
    const { fakeWindow, instances, sendBeacon } = installBrowserGlobals()
    const vitals: Array<WebVitalMetric> = []
    const options: ClientTelemetryOptions = {
      endpoint: '/api/telemetry',
      onVital: (metric) => vitals.push(metric),
    }
    const cleanup = initClientTelemetry(options)
    instances[0]?.callback({ getEntries: () => [] })
    instances[0]?.callback({ getEntries: () => [fakeEntry({ startTime: 412 })] })
    instances[1]?.callback({
      getEntries: () => [
        fakeEntry({ hadRecentInput: true, value: 0.5 }),
        fakeEntry({ hadRecentInput: false, value: 0.04 }),
      ],
    })
    instances[2]?.callback({
      getEntries: () => [
        fakeEntry({ duration: 20, interactionId: 0 }),
        fakeEntry({ duration: 64, interactionId: 7 }),
        fakeEntry({ duration: 40, interactionId: 8 }),
      ],
    })
    const expectedNames: ReadonlyArray<WebVitalName> = ['LCP', 'CLS', 'INP']
    expect(vitals.map((metric) => metric.name)).toEqual(expectedNames)
    expect(vitals).toEqual([
      { name: 'LCP', value: 412 },
      { name: 'CLS', value: 0.04 },
      { name: 'INP', value: 64 },
    ])
    expect(sendBeacon).toHaveBeenCalledTimes(3)
    cleanup()
    expect(instances.every((instance) => instance.disconnect.mock.calls.length === 1)).toBe(true)
    expect(fakeWindow.listeners.get('error')?.size).toBe(0)
  })

  it('handles missing PerformanceObserver, unsupported observer types, callback-only vitals, and missing sendBeacon', () => {
    const { instances } = installBrowserGlobals({ failEventType: 'event', sendBeacon: false })
    const vitals: Array<WebVitalMetric> = []
    const cleanup = initClientTelemetry({ endpoint: '/api/rum' })
    const callbackOnlyCleanup = initClientTelemetry({ onVital: (metric) => vitals.push(metric) })
    instances[0]?.callback({ getEntries: () => [fakeEntry({ startTime: 100 })] })
    instances[3]?.callback({ getEntries: () => [fakeEntry({ startTime: 250 })] })
    cleanup()
    callbackOnlyCleanup()
    vi.stubGlobal('PerformanceObserver', undefined)
    const noObserverCleanup = initClientTelemetry({ onVital: () => {} })
    noObserverCleanup()
    expect(vitals).toEqual([{ name: 'LCP', value: 250 }])
  })

  it('captures window errors, unhandled rejections, and direct reportClientError calls', () => {
    const { fakeWindow, sendBeacon } = installBrowserGlobals()
    const captured: Array<ClientErrorPayload> = []
    const options: ClientTelemetryOptions = {
      endpoint: '/api/rum',
      onError: (payload) => captured.push(payload),
    }
    const cleanup = initClientTelemetry(options)
    fakeWindow.dispatch('error', { error: Object.assign(new Error('first\nsecond'), { name: '' }) })
    fakeWindow.dispatch('error', { error: undefined, message: 'script failed\nline2' })
    fakeWindow.dispatch('unhandledrejection', { reason: 404 })
    reportClientError(new TypeError('direct failure'), { onError: (payload) => captured.push(payload) })
    expect(captured).toEqual([
      { kind: 'error', message: 'first', name: 'Error' },
      { kind: 'error', message: 'script failed', name: 'Error' },
      { kind: 'unhandledrejection', message: 'Unknown client error', name: 'UnknownError' },
      { kind: 'error', message: 'direct failure', name: 'TypeError' },
    ])
    expect(sendBeacon).toHaveBeenCalledTimes(3)
    cleanup()
  })
})
