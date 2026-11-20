import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './openapi.json',
  output: {
    clean: true,
    header: ({ defaultValue }) => [...defaultValue, '// fallow-ignore-file security-sink'],
    path: './src/sdk',
  },
  parser: { pagination: { keywords: ['cursor'] } },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    { infiniteQueryKeys: true, infiniteQueryOptions: true, name: '@tanstack/react-query' },
    'msw',
  ],
})
