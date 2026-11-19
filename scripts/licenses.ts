// License gate over the production dependencies, the packages whose code ships in .output and the Docker image
// (`pnpm licenses list --json --prod`, read from node_modules: offline, well under a second). Every package must
// carry a license from ALLOWED, satisfy one alternative of an `OR` expression and every part of an `AND`
// (spdx-satisfies), or be one of the exact versions in EXCEPTIONS. Anything else fails, including copyleft
// licenses (GPL, LGPL, AGPL, SSPL, BUSL) and packages without a license.
// Usage: pnpm licenses:check   (a gate of `pnpm check`)
import satisfies from 'spdx-satisfies'
import { xSync } from 'tinyexec'

type Allowance = { onlyFor?: Array<string>; why: string }

/** Licenses any production package may carry. `onlyFor` limits one to the packages named there. */
const ALLOWED = {
  '0BSD': { why: 'permissive, no attribution' },
  'Apache-2.0': { why: 'permissive, with a patent grant' },
  'BlueOak-1.0.0': { why: 'permissive' },
  'BSD-2-Clause': { why: 'permissive' },
  'BSD-3-Clause': { why: 'permissive' },
  'CC-BY-4.0': {
    onlyFor: ['caniuse-lite'],
    why: 'browser support data, not code: attribution only (caniuse-lite, through browserslist)',
  },
  'CC0-1.0': { why: 'public domain dedication' },
  ISC: { why: 'permissive' },
  MIT: { why: 'permissive' },
  'MIT-0': { why: 'permissive, no attribution' },
  'MPL-2.0': {
    why: 'file-level copyleft: only modified MPL files must be published; the bundle uses them unmodified',
  },
  'Python-2.0': { onlyFor: ['argparse'], why: 'permissive (PSF license of the Python argparse port)' },
  Unlicense: { why: 'public domain dedication' },
} satisfies Record<string, Allowance>

/**
 * Exact versions accepted with a license outside ALLOWED (a missing or non-SPDX license field that the
 * package's own LICENSE file resolves, for example): `'name@version': 'why'`. None today.
 */
const EXCEPTIONS: Record<string, string> = {}

type Package = { license: string; name: string; versions: Array<string> }

const listed = xSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
  nodeOptions: { maxBuffer: 64 * 1024 * 1024 },
})
let byLicense: Record<string, Array<Package>>
try {
  byLicense = JSON.parse(listed.stdout) as Record<string, Array<Package>>
} catch {
  console.error(
    `pnpm licenses list failed (exit ${listed.exitCode}, expected JSON on stdout):\n` +
      (listed.stderr || listed.stdout).trim(),
  )
  process.exit(1)
}

/** The SPDX expression is satisfied by the licenses this package may carry; a non-SPDX string is not. */
const acceptable = (expression: string, name: string) => {
  const allowed = Object.entries<Allowance>(ALLOWED)
    .filter(([, { onlyFor }]) => !onlyFor || onlyFor.includes(name))
    .map(([license]) => license)
  try {
    return satisfies(expression, allowed)
  } catch {
    // spdx-satisfies throws on anything that is not an SPDX expression ("SEE LICENSE IN ...", "UNLICENSED").
    return false
  }
}

/** Every installed version of every production package, with the license it declares. */
const installed = Object.entries(byLicense).flatMap(([license, packages]) =>
  packages.flatMap(({ name, versions }) => versions.map((version) => ({ id: `${name}@${version}`, license, name }))),
)

const problems: Array<string> = []
const used = new Set<string>()
for (const { id, license, name } of installed) {
  if (acceptable(license, name)) {
    continue
  }
  if (EXCEPTIONS[id]) {
    used.add(id)
    continue
  }
  const copyleft = /\b(A?GPL|LGPL|SSPL|BUSL|EUPL|OSL|CPAL)\b/i.test(license)
  problems.push(`${id}: ${license}${copyleft ? ' (copyleft: not allowed in the shipped bundle)' : ''}`)
}
for (const id of Object.keys(EXCEPTIONS)) {
  if (!used.has(id)) {
    problems.push(`EXCEPTIONS in scripts/licenses.ts: ${id} is not needed anymore; remove it`)
  }
}

if (problems.length) {
  console.error(
    `License check failed (${installed.length} production packages):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  )
  process.exitCode = 1
} else {
  console.log(
    `ok    ${installed.length} production packages, licenses: ${Object.keys(byLicense).toSorted().join(', ')}`,
  )
}
