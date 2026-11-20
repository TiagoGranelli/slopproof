const DEFAULT_AFTER_SIGN_IN = '/dashboard'
const PLACEHOLDER_ORIGIN = 'http://app.invalid'
const MAX_LENGTH = 2048

const parse = (path: string) => {
  try {
    const url = new URL(path, PLACEHOLDER_ORIGIN)
    return url.origin === PLACEHOLDER_ORIGIN ? url : undefined
  } catch {
    return undefined
  }
}

const decode = (path: string) => {
  try {
    return decodeURIComponent(path)
  } catch {
    return undefined
  }
}

const isLoginOrApi = (path: string) => {
  const route = path.toLowerCase().replace(/\/+$/, '')
  return route === '/login' || route === '/api' || route.startsWith('/api/')
}

export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_LENGTH || !value.startsWith('/') || value.includes('\\')) {
    return DEFAULT_AFTER_SIGN_IN
  }
  const url = parse(value)
  const decoded = url && decode(url.pathname)
  const decodedUrl = decoded === undefined ? undefined : parse(decoded)
  if (!url || decoded === undefined || !decodedUrl || decoded.includes('\\')) {
    return DEFAULT_AFTER_SIGN_IN
  }
  for (const path of [url.pathname, decoded, decodedUrl.pathname]) {
    if (path.startsWith('//') || isLoginOrApi(path)) {
      return DEFAULT_AFTER_SIGN_IN
    }
  }
  const target = url.pathname + url.search + url.hash
  return target.length > MAX_LENGTH ? DEFAULT_AFTER_SIGN_IN : target
}
