import { build } from 'vite'

const COMMANDS = { 'scripts/create-user.ts': 'create-user.mjs', 'scripts/migrate.ts': 'migrate.mjs' }

for (const [entry, file] of Object.entries(COMMANDS)) {
  await build({
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: '.output',
      rolldownOptions: {
        external: ['pg-native', /^#tanstack-(router|start)-entry$/, /^tanstack-start-[a-z-]+:v$/],
        onLog: (level, log, handler) => {
          if (log.code !== 'MODULE_LEVEL_DIRECTIVE') {
            handler(level, log)
          }
        },
        output: { codeSplitting: false, entryFileNames: file, format: 'es' },
      },
      ssr: entry,
      target: 'node26',
    },
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    ssr: { noExternal: true, target: 'node' },
  })
  console.log(`wrote .output/${file}`)
}
