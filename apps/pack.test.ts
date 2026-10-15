// What `apps/pack.ts` stages beside the build: the user guides, at their repository paths so a link from one to another
// resolves inside `node_modules/mithaq/docs/`, where a project's agent reads the guides of the version it installed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const staged = join(root, '.pack/mithaq')
execFileSync(process.execPath, ['apps/pack.ts'], { cwd: root, stdio: 'ignore' })

test('the mithaq package ships each user guide as the repository holds it, and every link between them resolves inside the package', () => {
  const guides = ['packages/mithaq/README.md', 'packages/mithaq/src/asas/cli/README.md', 'packages/mithaq/src/asas/runner/README.md', 'packages/mithaq/src/drizzle/README.md', 'packages/mithaq-admin/README.md', 'templates/asas/README.md']
  assert.deepEqual(readdirSync(join(staged, 'docs'), { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.md')).sort(), [...guides].sort(), 'the guides alone, no contributor AGENTS.md')
  for (const guide of guides) {
    const text = readFileSync(join(staged, 'docs', guide), 'utf8')
    assert.equal(text, readFileSync(join(root, guide), 'utf8'), guide)
    for (const [, link] of text.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) assert.ok(existsSync(join(staged, 'docs', dirname(guide), link!)), `${guide} links ${link}`)
  }
  assert.ok((JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')) as { files: string[] }).files.includes('docs'), 'and npm packs them')
})

test('the mithaq package ships the workflow skills a created project carries in .claude/skills, at that version', () => {
  const skills = join(root, 'templates/asas/.claude/skills')
  assert.deepEqual(readdirSync(join(staged, 'skills')).sort(), readdirSync(skills).sort())
  for (const skill of readdirSync(skills)) assert.equal(readFileSync(join(staged, 'skills', skill, 'SKILL.md'), 'utf8'), readFileSync(join(skills, skill, 'SKILL.md'), 'utf8'), skill)
  assert.ok((JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')) as { files: string[] }).files.includes('skills'), 'and npm packs them')
})

test('a file left untracked beside a skill never ships', () => {
  // Beside an existing skill rather than as a folder of its own, so a test reading the skill folders meanwhile sees the same four.
  const stray = join(root, 'templates/asas/.claude/skills/add-kayan/stray.md')
  writeFileSync(stray, 'left in the working tree\n')
  try {
    execFileSync(process.execPath, ['apps/pack.ts'], { cwd: root, stdio: 'ignore' })
    assert.ok(!existsSync(join(staged, 'skills/add-kayan/stray.md')))
  } finally {
    rmSync(stray)
  }
})
