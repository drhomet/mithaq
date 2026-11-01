import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { changelogSection, distTag, isVersion, releaseChangelog, taggedVersion } from './release.ts'

test('a version is semver without build metadata, and without leading zeros', () => {
  for (const version of ['0.2.0', '1.0.0', '10.20.30', '1.0.0-rc.1', '1.0.0-alpha', '1.0.0-0.3.7', '1.0.0-x-y.1']) assert.ok(isVersion(version), version)
  for (const version of ['', 'v1.0.0', '1.0', '1.0.0.0', '01.0.0', '1.02.0', '1.0.0-', '1.0.0-01', '1.0.0+build', '1.0.0-rc..1', ' 1.0.0', '1.0.0\n']) {
    assert.equal(isVersion(version), false, JSON.stringify(version))
  }
})

const fixture = (t: TestContext) => {
  const folder = fileURLToPath(new URL('../.rounds/61-release-pr/', import.meta.url))
  mkdirSync(folder, { recursive: true })
  const dir = mkdtempSync(join(folder, 'fixture-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo with spaces')
  const origin = join(dir, 'origin.git')
  const bin = join(dir, 'bin')
  for (const path of [join(repo, 'apps'), join(repo, 'packages/mithaq'), bin]) mkdirSync(path, { recursive: true })
  const env: NodeJS.ProcessEnv & { GH_ARGS: string } = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GH_ARGS: join(dir, 'gh-args') }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--bare', origin)
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release@example.test')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  git('config', 'core.hooksPath', '/dev/null')
  copyFileSync(fileURLToPath(new URL('./release.ts', import.meta.url)), join(repo, 'apps/release.ts'))
  writeFileSync(join(repo, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(repo, 'packages/mithaq/package.json'), '{"version":"0.0.0","publishConfig":{"version":"0.3.9"}}\n')
  const notes = '- Fix: owner\'s "release".\n  Keep $(touch injected) and `touch injected` literal.\n\n- Addition: \' ; touch injected; #\n  Last line.'
  writeFileSync(join(repo, 'CHANGELOG.md'), changelog(`## Unreleased\n\n${notes}`, '## 0.3.9\n\n- Older.'))
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\n[ "$1" = view ] || exit 99\nprintf "E404\\n" >&2\nexit 1\n', { mode: 0o755 })
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\0" "$@" > "$GH_ARGS"\n', { mode: 0o755 })
  git('add', '.')
  git('commit', '--quiet', '-m', 'The fixture starts here.')
  git('remote', 'add', 'origin', origin)
  git('push', '--quiet', '-u', 'origin', 'main')
  const run = (...args: string[]) => spawnSync(process.execPath, ['apps/release.ts', ...args], { cwd: repo, env, encoding: 'utf8' })
  const state = () => ({
    head: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    refs: git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags'),
    status: git('status', '--porcelain'),
    diff: git('diff', 'HEAD'),
    staged: git('diff', '--cached'),
  })
  return { dir, repo, origin, bin, env, git, notes, run, state }
}

test('preparing a release commits its version and notes on a branch, leaving main and tags alone', (t) => {
  const f = fixture(t)
  const main = f.git('rev-parse', 'main')
  const result = f.run('0.4.0')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(f.git('rev-parse', 'main'), main)
  assert.equal(f.git('branch', '--show-current'), 'release/v0.4.0')
  assert.equal(f.git('tag'), '')
  assert.equal(f.git('log', '--format=%s', '-1'), 'The packages are at version 0.4.0.')
  const manifest = JSON.parse(f.git('show', 'HEAD:packages/mithaq/package.json'))
  assert.equal(manifest.publishConfig.version, '0.4.0')
  assert.equal(manifest.version, '0.0.0')
  assert.equal(changelogSection({ changelog: f.git('show', 'HEAD:CHANGELOG.md'), heading: '0.4.0' }), f.notes)
  assert.equal(f.git('diff', '--name-only', 'main', 'HEAD'), 'CHANGELOG.md\npackages/mithaq/package.json')
  assert.equal(f.git('status', '--porcelain'), '')
  assert.equal(f.git('ls-remote', '--heads', 'origin', 'release/v0.4.0'), '')
  const push = result.stdout.match(/^\s*(git push .+)$/m)?.[1]
  assert.equal(push, 'git push -u origin release/v0.4.0')
  execFileSync('/bin/sh', ['-c', push!], { cwd: f.repo, env: f.env, stdio: 'pipe' })
  const command = result.stdout.slice(result.stdout.indexOf('gh pr create')).trimEnd()
  assert.ok(command.startsWith('gh pr create'), result.stdout)
  execFileSync('/bin/sh', ['-c', command], { cwd: f.repo, env: f.env })
  const args = readFileSync(f.env.GH_ARGS, 'utf8').split('\0').slice(0, -1)
  assert.deepEqual(args, ['pr', 'create', '--base', 'main', '--head', 'release/v0.4.0', '--title', 'Release v0.4.0', '--body', f.notes])
  assert.equal(existsSync(join(f.repo, 'injected')), false)
})

for (const operation of ['preparation', 'tagging']) test(`${operation} requires clean main equal to freshly fetched origin/main`, async (t) => {
  for (const mode of ['wrong branch', 'detached', 'dirty', 'staged', 'ahead', 'behind', 'diverged', 'fetch failure']) await t.test(mode, (t) => {
    const f = fixture(t)
    const base = f.git('rev-parse', 'HEAD')
    if (mode === 'wrong branch') f.git('switch', '-c', 'feature')
    if (mode === 'detached') f.git('checkout', '--detach')
    if (mode === 'dirty' || mode === 'staged') {
      writeFileSync(join(f.repo, 'CHANGELOG.md'), '# Changed\n')
      if (mode === 'staged') f.git('add', 'CHANGELOG.md')
    }
    if (mode === 'behind' || mode === 'diverged') {
      f.git('commit', '--quiet', '--allow-empty', '-m', 'Remote advances.')
      f.git('push', '--quiet', 'origin', 'main')
      f.git('reset', '--hard', base)
      // A cached tracking ref matching HEAD must not pass for a fresh remote check.
      f.git('update-ref', 'refs/remotes/origin/main', base)
    }
    if (mode === 'ahead' || mode === 'diverged') f.git('commit', '--quiet', '--allow-empty', '-m', 'Local advances.')
    if (mode === 'fetch failure') f.git('remote', 'set-url', 'origin', join(f.dir, 'missing.git'))
    const before = f.state()
    const result = operation === 'preparation' ? f.run('0.4.0') : f.run('--tag', '0.4.0')
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, mode === 'wrong branch' || mode === 'detached' ? /cut from main/ : mode === 'dirty' || mode === 'staged' ? /uncommitted changes/ : mode === 'fetch failure' ? /fetch/ : /main must equal freshly fetched origin\/main/)
    assert.deepEqual(f.state(), before)
  })
})

for (const operation of ['preparation', 'tagging']) test(`${operation} refuses existing local or remote release refs before changing files`, async (t) => {
  for (const ref of operation === 'preparation' ? ['local tag', 'remote tag', 'local branch', 'remote branch'] : ['local tag', 'remote tag']) await t.test(ref, (t) => {
    const f = fixture(t)
    const tag = ref.endsWith('tag')
    const name = tag ? 'v0.4.0' : 'release/v0.4.0'
    f.git(tag ? 'tag' : 'branch', name)
    if (ref.startsWith('remote')) {
      const full = `refs/${tag ? 'tags' : 'heads'}/${name}`
      f.git('push', '--quiet', 'origin', `${full}:${full}`)
      f.git(tag ? 'tag' : 'branch', tag ? '-d' : '-D', name)
    }
    const before = f.state()
    const result = operation === 'preparation' ? f.run('0.4.0') : f.run('--tag', '0.4.0')
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, tag ? /tag v0\.4\.0 exists/ : /branch release\/v0\.4\.0 exists/)
    assert.deepEqual(f.state(), before)
  })
})

test('tagging after the owner merges creates only an annotated local tag at merged main HEAD', (t) => {
  const f = fixture(t)
  const prepared = f.run('0.4.0')
  assert.equal(prepared.status, 0, prepared.stderr)
  f.git('switch', 'main')
  f.git('merge', '--no-ff', '-m', 'The owner merges the release.', 'release/v0.4.0')
  f.git('push', '--quiet', 'origin', 'main')
  const before = f.state()
  // Tagging needs no registry query and must never publish.
  writeFileSync(join(f.bin, 'npm'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
  const result = f.run('--tag', '0.4.0')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(f.git('rev-parse', 'HEAD'), before.head)
  assert.equal(f.git('branch', '--show-current'), 'main')
  assert.equal(f.git('status', '--porcelain'), '')
  assert.equal(f.git('cat-file', '-t', 'v0.4.0'), 'tag')
  assert.equal(f.git('rev-parse', 'v0.4.0^{}'), before.head)
  assert.equal(f.git('for-each-ref', '--format=%(contents)', 'refs/tags/v0.4.0'), 'v0.4.0')
  assert.equal(f.git('ls-remote', '--tags', 'origin'), '')
  assert.match(result.stdout, /^\s*git push origin v0\.4\.0$/m)
})

test('the CLI refuses extra or missing arguments and invalid versions without mutation', (t) => {
  const f = fixture(t)
  const before = f.state()
  for (const args of [[], ['0.4.0', 'extra'], ['--tag'], ['--tag', '0.4.0', 'extra'], ['--publish', 'extra'], ['--unknown'], ['v0.4.0'], ['0.4'], ['0.4.0+build'], ['01.4.0'], ['--tag', 'v0.4.0'], ['--tag', '0.4.0\n']]) {
    const result = f.run(...args)
    assert.notEqual(result.status, 0, JSON.stringify(args))
    assert.match(result.stderr, /usage:|not a version/, JSON.stringify(args))
    assert.deepEqual(f.state(), before, JSON.stringify(args))
  }
})

test('tagging requires the matching publishConfig.version and nonempty version notes', async (t) => {
  for (const mode of ['version mismatch', 'missing notes', 'empty notes']) await t.test(mode, (t) => {
    const f = fixture(t)
    writeFileSync(join(f.repo, 'packages/mithaq/package.json'), JSON.stringify({ version: '0.4.0', publishConfig: { version: mode === 'version mismatch' ? '0.3.9' : '0.4.0' } }))
    writeFileSync(join(f.repo, 'CHANGELOG.md'), changelog(mode === 'missing notes' ? '## Unreleased\n\n- Pending.' : `## 0.4.0\n\n${mode === 'empty notes' ? '   ' : f.notes}`, '## 0.3.9\n\n- Older.'))
    f.git('add', '-u')
    f.git('commit', '--quiet', '-m', 'The fixture has release metadata.')
    f.git('push', '--quiet', 'origin', 'main')
    const before = f.state()
    const result = f.run('--tag', '0.4.0')
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, mode === 'version mismatch' ? /publishConfig.version must be 0\.4\.0/ : /no entries under "## 0\.4\.0"/)
    assert.deepEqual(f.state(), before)
  })
})

test('preparation keeps the changelog and npm refusals before creating a release branch', async (t) => {
  for (const mode of ['missing notes', 'empty notes', 'published', 'npm failure', 'npm empty response']) await t.test(mode, (t) => {
    const f = fixture(t)
    if (mode.endsWith('notes')) {
      writeFileSync(join(f.repo, 'CHANGELOG.md'), changelog(mode === 'empty notes' ? '## Unreleased\n\n ' : '## 0.3.9\n\n- Older.'))
      f.git('add', '-u')
      f.git('commit', '--quiet', '-m', 'The fixture has no release notes.')
      f.git('push', '--quiet', 'origin', 'main')
    } else {
      const response = mode === 'published' ? 'echo 0.4.0' : mode === 'npm failure' ? 'echo E500 >&2; exit 1' : 'exit 0'
      writeFileSync(join(f.bin, 'npm'), `#!/bin/sh\n${response}\n`, { mode: 0o755 })
    }
    const before = f.state()
    const result = f.run('0.4.0')
    if (mode === 'npm empty response') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(f.git('branch', '--show-current'), 'release/v0.4.0')
    } else {
      assert.notEqual(result.status, 0, result.stdout)
      assert.match(result.stderr, mode.endsWith('notes') ? /no entries under/ : mode === 'published' ? /is on npm/ : /npm view .* failed/)
      assert.deepEqual(f.state(), before)
    }
  })
})

test('preparation and tagging keep untracked files out and accept already named prerelease notes', (t) => {
  const f = fixture(t)
  const version = '0.4.0-rc.1'
  writeFileSync(join(f.repo, 'CHANGELOG.md'), changelog(`## ${version}\n\n${f.notes}`))
  f.git('add', '-u')
  f.git('commit', '--quiet', '-m', 'The release candidate has notes.')
  f.git('push', '--quiet', 'origin', 'main')
  writeFileSync(join(f.repo, 'scratch'), 'Keep this untracked.\n')
  const result = f.run(version)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(f.git('status', '--porcelain'), '?? scratch')
  assert.equal(f.git('diff', '--name-only', 'main', 'HEAD'), 'packages/mithaq/package.json')
  f.git('switch', 'main')
  f.git('merge', '--ff-only', `release/v${version}`)
  f.git('push', '--quiet', 'origin', 'main')
  const tagged = f.run('--tag', version)
  assert.equal(tagged.status, 0, tagged.stderr)
  assert.equal(f.git('cat-file', '-t', `v${version}`), 'tag')
  assert.equal(f.git('status', '--porcelain'), '?? scratch')
  assert.equal(readFileSync(join(f.repo, 'scratch'), 'utf8'), 'Keep this untracked.\n')
})

test('a failed remote tag query refuses preparation and tagging even when fetching main succeeds', async (t) => {
  for (const args of [['0.4.0'], ['--tag', '0.4.0']]) await t.test(args.join(' '), (t) => {
    const f = fixture(t)
    const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
    f.env.REAL_GIT = realGit
    writeFileSync(join(f.bin, 'git'), '#!/bin/sh\nif [ "$1" = ls-remote ]; then echo "remote query failed" >&2; exit 1; fi\nexec "$REAL_GIT" "$@"\n', { mode: 0o755 })
    const before = f.state()
    const result = f.run(...args)
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /remote query failed/)
    assert.deepEqual(f.state(), before)
  })
})

test('a plain version goes to latest, a prerelease to next, and anything else is refused', () => {
  assert.equal(distTag('0.2.0'), 'latest')
  assert.equal(distTag('1.0.0-rc.1'), 'next')
  assert.equal(distTag('0.2.0-0'), 'next')
  assert.throws(() => distTag('v0.2.0'), /not a version/)
  assert.throws(() => distTag(''), /not a version/)
})

test('the tag that triggered the run must be v and the staged version', () => {
  assert.equal(taggedVersion({ ref: 'v0.2.0', version: '0.2.0' }), '0.2.0')
  assert.equal(taggedVersion({ ref: 'v1.0.0-rc.1', version: '1.0.0-rc.1' }), '1.0.0-rc.1')
  assert.throws(() => taggedVersion({ ref: 'v0.2.1', version: '0.2.0' }), /v0\.2\.1 does not match/)
  assert.throws(() => taggedVersion({ ref: '0.2.0', version: '0.2.0' }), /does not match/)
  assert.throws(() => taggedVersion({ ref: 'main', version: '0.2.0' }), /does not match/)
  assert.throws(() => taggedVersion({ ref: undefined, version: '0.2.0' }), /does not match/)
  assert.throws(() => taggedVersion({ ref: 'vnope', version: 'nope' }), /not a version/)
})

const changelog = (...sections: string[]) => `# Changelog\n\n${sections.join('\n\n')}\n`

test("a version's notes are its changelog section, up to the next heading, and nothing when it is missing or empty", () => {
  const text = changelog('## 0.3.10\n\n- Fix: one.\n  Two lines.\n- Addition: three.', '## 0.3.9\n\n- Fix: older.')
  assert.equal(changelogSection({ changelog: text, heading: '0.3.10' }), '- Fix: one.\n  Two lines.\n- Addition: three.')
  assert.equal(changelogSection({ changelog: text, heading: '0.3.9' }), '- Fix: older.')
  assert.equal(changelogSection({ changelog: text, heading: '0.3.1' }), undefined)
  assert.equal(changelogSection({ changelog: changelog('## 0.4.0\n\n', '## 0.3.9\n\n- Fix: older.'), heading: '0.4.0' }), undefined)
})

test('a release renames Unreleased to its version, keeps an entry already renamed, and refuses one with nothing to say', () => {
  const unreleased = changelog('## Unreleased\n\n- Fix: one.', '## 0.3.9\n\n- Fix: older.')
  assert.equal(releaseChangelog({ changelog: unreleased, version: '0.3.10' }), changelog('## 0.3.10\n\n- Fix: one.', '## 0.3.9\n\n- Fix: older.'))
  const renamed = changelog('## 0.3.10\n\n- Fix: one.', '## 0.3.9\n\n- Fix: older.')
  assert.equal(releaseChangelog({ changelog: renamed, version: '0.3.10' }), renamed)
  const refused: [string, RegExp][] = [
    [changelog('## Unreleased\n\n- Fix: two.', '## 0.3.10\n\n- Fix: one.'), /both "## Unreleased" and "## 0\.3\.10"/],
    [changelog('## Unreleased\n\n- Fix: one.', '## Unreleased\n\n- Fix: two.'), /more than one "## Unreleased"/],
    [changelog('## 0.3.10\n', '## Unreleased\n\n- Fix: one.'), /empty "## 0\.3\.10"/],
  ]
  for (const [text, reason] of refused) assert.throws(() => releaseChangelog({ changelog: text, version: '0.3.10' }), reason)
  assert.equal(releaseChangelog({ changelog: ' ## Unreleased\r\n\r\n- Fix: one.\r\n', version: '0.3.10' }), '## 0.3.10\r\n\r\n- Fix: one.\r\n')
  for (const text of [changelog('## Unreleased\n', '## 0.3.9\n\n- Fix: older.'), changelog('## 0.3.9\n\n- Fix: older.')]) {
    assert.throws(() => releaseChangelog({ changelog: text, version: '0.3.10' }), /no entries under "## Unreleased" or "## 0\.3\.10"/)
  }
})
