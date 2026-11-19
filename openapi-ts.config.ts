import { defineConfig } from '@hey-api/openapi-ts'

// openapi.json is generated from src/contract by `pnpm openapi:generate`; both are committed.
export default defineConfig({
  input: './openapi.json',
  output: {
    clean: true,
    path: './src/sdk',
    // A codegen run is not a change we review: `fallow security` (the pre-commit `security` job) skips these files.
    header: ({ defaultValue }) => [...defaultValue, '// fallow-ignore-file security-sink'],
  },
  // An operation with a query parameter named `cursor` is paginated: the TanStack Query plugin gives it
  // `*InfiniteOptions` that pass each page param as `query.cursor`. Only `cursor`, so a future `page` or
  // `offset` parameter does not silently become an infinite query too.
  parser: { pagination: { keywords: ['cursor'] } },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    { infiniteQueryKeys: true, infiniteQueryOptions: true, name: '@tanstack/react-query' },
    // Typed MSW handlers for component tests, regenerated with the contract so mocks cannot drift.
    'msw',
  ],
})
