export type WebVitalName = 'CLS' | 'INP' | 'LCP'

export interface WebVitalMetric {
  readonly name: WebVitalName
  readonly value: number
}

export interface ClientErrorPayload {
  readonly kind: 'error' | 'unhandledrejection'
  readonly message: string
  readonly name: string
}

export interface ClientTelemetryOptions {
  readonly endpoint?: string
  readonly onError?: (payload: ClientErrorPayload) => void
  readonly onVital?: (metric: WebVitalMetric) => void
}

const MAX_ERROR_MESSAGE_LENGTH = 256

const isSameOriginEndpoint = (endpoint: string | undefined): endpoint is string =>
  typeof endpoint === 'string' && endpoint.startsWith('/') && !endpoint.startsWith('//')

const sendTelemetryBeacon = (endpoint: string, payload: unknown): void => {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return
  }
  navigator.sendBeacon(endpoint, JSON.stringify(payload))
}

const firstLineOf = (text: string): string => {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

const sanitizeClientError = (error: unknown, kind: ClientErrorPayload['kind']): ClientErrorPayload => {
  if (error instanceof Error) {
    return { kind, message: firstLineOf(error.message).slice(0, MAX_ERROR_MESSAGE_LENGTH), name: error.name || 'Error' }
  }
  if (typeof error === 'string') {
    return { kind, message: firstLineOf(error).slice(0, MAX_ERROR_MESSAGE_LENGTH), name: 'Error' }
  }
  return { kind, message: 'Unknown client error', name: 'UnknownError' }
}

export const reportClientError = (
  error: unknown,
  options: ClientTelemetryOptions,
  kind: ClientErrorPayload['kind'] = 'error',
): void => {
  const payload = sanitizeClientError(error, kind)
  options.onError?.(payload)
  if (isSameOriginEndpoint(options.endpoint)) {
    sendTelemetryBeacon(options.endpoint, { ...payload, type: 'error' })
  }
}

const isLayoutShiftEntry = (
  entry: PerformanceEntry,
): entry is PerformanceEntry & { hadRecentInput: boolean; value: number } =>
  'value' in entry &&
  typeof entry.value === 'number' &&
  'hadRecentInput' in entry &&
  typeof entry.hadRecentInput === 'boolean'

const isEventTimingEntry = (entry: PerformanceEntry): entry is PerformanceEntry & { interactionId: number } =>
  'interactionId' in entry && typeof entry.interactionId === 'number'

const observeType = (
  entryType: string,
  onEntries: (entries: ReadonlyArray<PerformanceEntry>) => void,
): PerformanceObserver | null => {
  if (typeof PerformanceObserver !== 'function') {
    return null
  }
  try {
    const observer = new PerformanceObserver((list) => {
      onEntries(list.getEntries())
    })
    observer.observe({ buffered: true, type: entryType })
    return observer
  } catch {
    return null
  }
}

const observeLcp = (emitVital: (metric: WebVitalMetric) => void): PerformanceObserver | null =>
  observeType('largest-contentful-paint', (entries) => {
    const latest = entries.at(-1)
    if (latest) {
      emitVital({ name: 'LCP', value: latest.startTime })
    }
  })

const observeCls = (emitVital: (metric: WebVitalMetric) => void): PerformanceObserver | null => {
  let clsTotal = 0
  return observeType('layout-shift', (entries) => {
    for (const entry of entries) {
      if (isLayoutShiftEntry(entry) && !entry.hadRecentInput) {
        clsTotal += entry.value
        emitVital({ name: 'CLS', value: clsTotal })
      }
    }
  })
}

const observeInp = (emitVital: (metric: WebVitalMetric) => void): PerformanceObserver | null => {
  let maxInp = 0
  return observeType('event', (entries) => {
    for (const entry of entries) {
      if (isEventTimingEntry(entry) && entry.interactionId > 0 && entry.duration > maxInp) {
        maxInp = entry.duration
        emitVital({ name: 'INP', value: maxInp })
      }
    }
  })
}

const attachVitalObservers = (emitVital: (metric: WebVitalMetric) => void): Array<PerformanceObserver> =>
  [observeLcp(emitVital), observeCls(emitVital), observeInp(emitVital)].filter(
    (observer): observer is PerformanceObserver => observer !== null,
  )

const attachErrorListeners = (options: ClientTelemetryOptions): (() => void) => {
  const onWindowError = (event: ErrorEvent): void => {
    reportClientError(event.error ?? event.message, options, 'error')
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    reportClientError(event.reason, options, 'unhandledrejection')
  }
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => {
    window.removeEventListener('error', onWindowError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}

export const initClientTelemetry = (options: ClientTelemetryOptions): (() => void) => {
  const endpoint = isSameOriginEndpoint(options.endpoint) ? options.endpoint : undefined
  if (typeof window === 'undefined' || (!endpoint && !options.onVital && !options.onError)) {
    return () => {}
  }
  const emitVital = (metric: WebVitalMetric): void => {
    options.onVital?.(metric)
    if (endpoint) {
      sendTelemetryBeacon(endpoint, { ...metric, type: 'vital' })
    }
  }
  const observers = attachVitalObservers(emitVital)
  const detachErrors = attachErrorListeners(options)
  return () => {
    for (const observer of observers) {
      observer.disconnect()
    }
    detachErrors()
  }
}
