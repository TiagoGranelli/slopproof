import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const input = JSON.parse(readFileSync(0, 'utf8')) as { tool_input?: { file_path?: string } }
const file = relative(root, input.tool_input?.file_path ?? root)
const run = (tool: string, args: Array<string>) =>
  spawnSync(join('node_modules', '.bin', tool), [...args, '--no-error-on-unmatched-pattern', file], {
    cwd: root,
    encoding: 'utf8',
  })

if (file !== '' && !file.startsWith('..')) {
  const format = run('oxfmt', [])
  const check =
    format.status === 0 ? run('oxlint', ['--deny-warnings', '--format=agent', '-A', 'no-unused-vars']) : format
  if (check.status !== 0) {
    const reason = `${check.stdout}${check.stderr}`.trim()
    console.log(JSON.stringify({ decision: 'block', reason: `${reason}\n\nFix this in ${file}.` }))
  }
}
