import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { distTag, isVersion, notesRange, previousTag, taggedVersion } from './release.ts'

test('a version is semver without build metadata, and without leading zeros', () => {
  for (const version of ['0.2.0', '1.0.0', '10.20.30', '1.0.0-rc.1', '1.0.0-alpha', '1.0.0-0.3.7', '1.0.0-x-y.1']) assert.ok(isVersion(version), version)
  for (const version of ['', 'v1.0.0', '1.0', '1.0.0.0', '01.0.0', '1.02.0', '1.0.0-', '1.0.0-01', '1.0.0+build', '1.0.0-rc..1', ' 1.0.0', '1.0.0\n']) {
    assert.equal(isVersion(version), false, JSON.stringify(version))
  }
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

test('a plain release takes its notes from the last plain release, a prerelease from the last tag of any kind', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mithaq-release-test-'))
  try {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, stdio: 'ignore' })
    const release = (tag: string) => {
      git('commit', '--allow-empty', '-qm', tag)
      git('tag', '-a', tag, '-m', tag)
    }
    git('init', '-q')
    release('v0.1.0')
    assert.equal(previousTag({ cwd, version: '0.1.0' }), undefined)
    release('v0.2.0-rc.1')
    release('v0.2.0-rc.2')
    release('v0.2.0')
    release('v0.3.0-rc.1')
    assert.equal(previousTag({ cwd, version: '0.2.0-rc.2' }), 'v0.2.0-rc.1')
    assert.equal(previousTag({ cwd, version: '0.2.0' }), 'v0.1.0')
    assert.equal(previousTag({ cwd, version: '0.3.0-rc.1' }), 'v0.2.0')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the notes run from the previous tag, or over the whole history when there is none', () => {
  assert.equal(notesRange({ previous: 'v0.1.1', tag: 'v0.2.0' }), 'v0.1.1..v0.2.0')
  assert.equal(notesRange({ previous: undefined, tag: 'v0.2.0' }), 'v0.2.0')
})
