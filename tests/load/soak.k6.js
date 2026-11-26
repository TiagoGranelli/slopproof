/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/strict-boolean-expressions */
import { check, sleep } from 'k6'
import http from 'k6/http'
import { Counter } from 'k6/metrics'

const ENV_KEY = '__ENV'
const k6Env = globalThis[ENV_KEY] ?? {}
const baseUrl = k6Env.BASE_URL ?? 'http://127.0.0.1:3000'
const authCookie = k6Env.AUTH_COOKIE ?? ''
const targetVus = Number(k6Env.SOAK_VUS ?? '15')
const holdDuration = k6Env.SOAK_DURATION ?? '10m'
const serverErrors = new Counter('server_errors')

export const options = {
  stages: [
    { duration: '30s', target: targetVus },
    { duration: holdDuration, target: targetVus },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<400', 'p(99)<800'],
    http_req_failed: ['rate<0.01'],
    server_errors: ['count==0'],
  },
}

const buildBatch = () => {
  const requests = [
    ['GET', `${baseUrl}/`],
    ['GET', `${baseUrl}/api/posts`],
    ['GET', `${baseUrl}/api/ready`],
    ['GET', `${baseUrl}/api/health`],
  ]
  if (authCookie) {
    requests.push(['GET', `${baseUrl}/api/me`, null, { headers: { cookie: authCookie } }])
  }
  return requests
}

export default function runSoak() {
  const batch = buildBatch()
  const responses = http.batch(batch)
  for (const response of responses) {
    if (response.status >= 500) {
      serverErrors.add(1)
    }
    check(response, { 'soak endpoint returned 200': (res) => res.status === 200 })
  }
  sleep(0.25)
}
