import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changelogSection, distTag, isVersion, releaseChangelog, taggedVersion } from './release.ts'

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
