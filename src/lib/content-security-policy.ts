type Sources = { script: ReadonlyArray<string>; style: ReadonlyArray<string> }
type DocumentHeaders = { 'content-security-policy': string }

export const documentHeaders = (sources: Sources): DocumentHeaders => ({
  'content-security-policy': [
    "default-src 'self'",
    `script-src ${["'self'", ...sources.script].join(' ')}`,
    `style-src ${["'self'", ...sources.style].join(' ')}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
})

export const nonceSources = (nonce: string): Sources => ({
  script: [`'nonce-${nonce}'`, "'strict-dynamic'"],
  style: [`'nonce-${nonce}'`],
})
