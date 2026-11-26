import { readFileSync } from 'node:fs'
import { IMAGES } from './images.ts'

const PINNED_COPIES = [
  'compose.yaml',
  'deploy/compose.smoke.yaml',
  'deploy/compose.production.yaml',
  '.github/compose.ci.yaml',
  '.github/workflows/ci.yml',
  '.github/workflows/deep-gates.yml',
  'Dockerfile',
  '.agents/evals/Dockerfile',
]

const PATTERNS = Object.values(IMAGES).map((ref) => {
  const name = ref.slice(0, ref.lastIndexOf(':', ref.indexOf('@')))
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`)
  return { pattern: new RegExp(`(?<![\\w./-])${escaped}:[\\w.-]+(@sha256:[0-9a-f]{64})?`, 'g'), ref }
})

export const pinProblems = (): Array<string> =>
  PINNED_COPIES.flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return PATTERNS.flatMap(({ pattern, ref }) =>
      [...text.matchAll(pattern)].flatMap((match) =>
        match[0] === ref ? [] : [`${file}: ${match[0]} (scripts/images.ts has ${ref})`],
      ),
    )
  })
