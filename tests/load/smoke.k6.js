/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/strict-boolean-expressions */
import { check, sleep } from 'k6'
import http from 'k6/http'
import { Counter } from 'k6/metrics'

const ENV_KEY = '__ENV'
const k6Env = globalThis[ENV_KEY] ?? {}
const baseUrl = k6Env.BASE_URL ?? 'http://127.0.0.1:3000'
const authCookie = k6Env.AUTH_COOKIE ?? ''
const serverErrors = new Counter('server_errors')

export const options = {
  duration: k6Env.DURATION ?? '15s',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    server_errors: ['count==0'],
  },
  vus: Number(k6Env.VUS ?? '5'),
}

const READ_PATHS = ['/', '/api/posts', '/api/ready', '/api/health']
const writeExpected = http.expectedStatuses(201, 429)

const recordRead = (path) => {
  const response = http.get(`${baseUrl}${path}`)
  if (response.status >= 500) {
    serverErrors.add(1)
  }
  check(response, { [`${path} status 200`]: (res) => res.status === 200 })
}

const probeWrite = () => {
  const response = http.post(`${baseUrl}/api/me/posts`, JSON.stringify({ body: 'k6 smoke probe' }), {
    headers: { 'content-type': 'application/json', cookie: authCookie, origin: baseUrl },
    responseCallback: writeExpected,
  })
  if (response.status >= 500) {
    serverErrors.add(1)
  }
  check(response, { 'write accepted or rate-limited': (res) => res.status === 201 || res.status === 429 })
}

export default function runSmoke() {
  for (const path of READ_PATHS) {
    recordRead(path)
  }
  if (authCookie) {
    probeWrite()
  }
  sleep(0.1)
}
