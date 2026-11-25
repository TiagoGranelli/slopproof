import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

const COVERAGE_GATE = [
  'src/features/auth/utils/safe-redirect.ts',
  'src/lib/api-error.ts',
  'src/features/auth/utils/describe-auth-failure.ts',
  'src/server/http/forwarded-for.ts',
  'src/server/http/client-address.ts',
  'src/features/auth/utils/describe-session.ts',
  'src/server/api/handlers.ts',
  'src/server/lifecycle.ts',
  'src/server/mail/auth-messages.ts',
  'src/server/env.ts',
  'src/lib/content-security-policy.ts',
  'src/lib/adopted-stylesheet-singleton.ts',
  'src/lib/truncate-text.ts',
  'src/features/posts/utils/post-editor-machine.ts',
  'src/features/auth/utils/auth-form-machine.ts',
  'src/components/lists/load-more-machine.ts',
]
const COVERAGE_FLOOR = { branches: 67, functions: 59, lines: 69, statements: 69 }
for (const file of COVERAGE_GATE) {
  readFileSync(file)
}

const mswWorkerScript = (): Plugin => ({
  configureServer(server) {
    const script = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js')
    server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
      res.setHeader('content-type', 'text/javascript')
      res.end(readFileSync(script))
    })
  },
  name: 'msw-worker-script',
})

const watched = Boolean(process.env.CI) || process.stdout.isTTY

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/sdk/**', 'src/routeTree.gen.ts', 'src/components/ui/**', 'src/server/db/schema/auth.ts'],
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
      reporter: process.env.CI ? ['text-summary'] : ['html'],
      thresholds: {
        ...COVERAGE_FLOOR,
        ...Object.fromEntries(COVERAGE_GATE.map((file) => [file, { branches: 100, lines: 100 }])),
      },
    },
    projects: [
      {
        test: {
          include: ['tests/unit/**/*.test.ts'],
          name: 'unit',
          testTimeout: 5000,
        },
      },
      {
        test: {
          env: {
            APP_URL: 'http://localhost:3000',
            BETTER_AUTH_SECRET: 'api-handler-tests-only-not-a-secret-000',
            DATABASE_URL: 'postgres://unused:unused@127.0.0.1:9/unused',
            NODE_ENV: 'test',
            TRUSTED_PROXIES: '',
          },
          include: ['tests/api/**/*.test.ts'],
          name: 'api',
          testTimeout: 5000,
        },
      },
      {
        optimizeDeps: {
          include: [
            'react',
            'react/jsx-dev-runtime',
            'react-dom/client',
            'react-dom/server',
            '@tanstack/react-form',
            '@tanstack/react-query',
            '@tanstack/react-router',
            'effect',
            'class-variance-authority',
            'cn',
            'radix-ui',
            'msw',
            'msw/browser',
            'fast-check',
            'vitest-browser-react',
          ],
        },
        plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss(), mswWorkerScript()],
        resolve: {
          alias: [
            {
              find: '#/lib/api-client.ts',
              replacement: fileURLToPath(new URL('./tests/component/stubs/api-client.ts', import.meta.url)),
            },
            {
              find: '#/lib/auth.functions.ts',
              replacement: fileURLToPath(new URL('./tests/component/stubs/auth-functions.ts', import.meta.url)),
            },
          ],
        },
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: 'chromium' }],
            provider: playwright({ launchOptions: { executablePath: process.env.CHROME_PATH || undefined } }),
            screenshotFailures: false,
          },
          include: ['tests/component/**/*.test.tsx'],
          name: 'component',
          setupFiles: ['tests/component/setup.ts'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          env: {
            APP_URL: 'http://localhost:3000',
            AUTH_SIGN_UP: 'closed',
            BETTER_AUTH_SECRET: 'db-tests-only-not-a-secret-0000000000',
            MAIL_FROM: '',
            NODE_ENV: 'test',
            SMTP_URL: '',
            TRUSTED_PROXIES: '',
          },
          globalSetup: ['tests/db/global-setup.ts'],
          hookTimeout: 30_000,
          include: ['tests/db/**/*.test.ts'],
          name: 'db',
          testTimeout: 15_000,
        },
      },
      {
        test: {
          fileParallelism: true,
          globalSetup: ['tests/integration/global-setup.ts'],
          hookTimeout: 15_000,
          include: ['tests/integration/**/*.test.ts'],
          name: 'integration',
          setupFiles: ['tests/integration/setup.ts'],
          testTimeout: 15_000,
        },
      },
    ],
    reporters: watched ? configDefaults.reporters : ['agent'],
  },
})
