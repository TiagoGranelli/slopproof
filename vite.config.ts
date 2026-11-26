import { fileURLToPath } from 'node:url'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { writeBuildStamp } from './scripts/build-freshness.ts'
import { documentHeaders } from './src/lib/content-security-policy.ts'
import { inlineSourceHashes } from './src/server/nitro/prerender-csp.ts'

const noDevtoolsInProduction: Plugin = {
  apply: 'build',
  config: () => ({
    resolve: {
      alias: [
        {
          find: /^@tanstack\/devtools-event-client$/,
          replacement: fileURLToPath(new URL('src/lib/no-devtools-event-client.ts', import.meta.url)),
        },
      ],
    },
  }),
  name: 'no-devtools-in-production',
}

const adoptedStylesheetSingleton: Plugin = {
  enforce: 'pre',
  name: 'adopted-stylesheet-singleton',
  resolveId(source, importer) {
    if ((source === './singleton' || source === './singleton.js') && importer?.includes('react-style-singleton')) {
      if (!importer.includes('react-style-singleton@2.2.3')) {
        throw new Error(`adopted-stylesheet-singleton was written for react-style-singleton 2.2.3, got ${importer}`)
      }
      return fileURLToPath(new URL('src/lib/adopted-stylesheet-singleton.ts', import.meta.url))
    }
    return null
  },
}

export default defineConfig({
  build: {
    rolldownOptions: {
      onLog(level, log, handler) {
        if (log.code === 'MODULE_LEVEL_DIRECTIVE' && log.message.includes('use client')) {
          return
        }
        handler(level, log)
      },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      compressPublicAssets: { brotli: true, gzip: true },
      hooks: {
        compiled(nitroBuild) {
          if (!nitroBuild.options.dev) {
            writeBuildStamp(nitroBuild.options.rootDir)
          }
        },
        'prerender:generate'(route, nitroBuild) {
          if (route.error || !route.contents || !route.contentType?.includes('text/html')) {
            return
          }
          const rule = nitroBuild.options.routeRules[route.route]
          nitroBuild.options.routeRules[route.route] = {
            ...rule,
            headers: { ...rule?.headers, ...documentHeaders(inlineSourceHashes(route.contents)) },
          }
        },
      },
      plugins: ['./src/server/nitro/startup.ts', './src/server/nitro/http.ts'],
      prerender: { crawlLinks: false, failOnError: true, routes: ['/about'] },
    }),
    react(),
    babel({ include: /[/\\]src[/\\].*\.tsx(?:$|\?)/, parallel: true, presets: [reactCompilerPreset()] }),
    adoptedStylesheetSingleton,
    noDevtoolsInProduction,
  ],
  server: {
    port: 3000,
    strictPort: true,
    watch: {
      ignored: [
        '**/.output/**',
        '**/.fallow/**',
        '**/.lighthouseci/**',
        '**/lighthouse-report/**',
        '**/playwright-report/**',
        '**/repos/**',
        '**/.agents/**',
        '**/.claude/**',
      ],
    },
  },
})
