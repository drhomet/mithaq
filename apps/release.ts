// `node apps/release.ts <version>` prepares a release branch for the owner to review through a pull request.
// `node apps/release.ts --tag <version>` tags merged main for the owner to push.
// `node apps/release.ts --publish` runs only in .github/workflows/release.yml, after `bun run test:release` has staged `.pack/`.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// semver.org's grammar without build metadata, which npm drops, so `1.0.0+a` and `1.0.0+b` would publish as one version.
const numeric = '(?:0|[1-9]\\d*)'
const identifier = `(?:${numeric}|\\d*[A-Za-z-][0-9A-Za-z-]*)`
const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`)

export const isVersion = (version: string) => semver.test(version)

/** A prerelease never reaches `latest`, which is what `npm install` takes, and nothing unparsed falls through to it. */
export const distTag = (version: string) => {
  assert.ok(isVersion(version), `${version} is not a version`)
  return version.includes('-') ? 'next' : 'latest'
}

/** npm publishes the staged manifest's version whatever the tag says, so the two must agree before anything ships. */
export const taggedVersion = ({ ref, version }: { ref: string | undefined; version: string }) => {
  assert.ok(isVersion(version), `${version} is not a version`)
  assert.equal(ref, `v${version}`, `the tag ${ref} does not match the staged version ${version}`)
  return version
}

/** A version's section of CHANGELOG.md, up to the next `## ` heading, or nothing when it is missing or empty. */
export const changelogSection = ({ changelog, heading }: { changelog: string; heading: string }) => {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start < 0) return undefined
  const next = lines.findIndex((line, at) => at > start && line.startsWith('## '))
  return lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim() || undefined
}

/** The changelog with its Unreleased entries under the version; a release that would drop, split or lack entries is refused. */
export const releaseChangelog = ({ changelog, version }: { changelog: string; version: string }) => {
  const heading = (line: string) => line.trim() === '## Unreleased'
  const lines = changelog.split('\n')
  assert.ok(lines.filter(heading).length <= 1, 'CHANGELOG.md has more than one "## Unreleased"')
  const pending = changelogSection({ changelog, heading: 'Unreleased' })
  const done = changelogSection({ changelog, heading: version })
  assert.ok(!(pending && done), `CHANGELOG.md has entries under both "## Unreleased" and "## ${version}"; keep them under one`)
  if (done) return changelog
  assert.ok(pending, `CHANGELOG.md has no entries under "## Unreleased" or "## ${version}"`)
  const next = lines.map((line) => (heading(line) ? line.replace(/^\s*## Unreleased/, `## ${version}`) : line)).join('\n')
  // An empty `## <version>` above it would win, and the tag would then publish nothing.
  assert.equal(changelogSection({ changelog: next, heading: version }), pending, `CHANGELOG.md has an empty "## ${version}" besides "## Unreleased"`)
  return next
}

const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const succeeds = (program: string, args: string[]) => spawnSync(program, args, { cwd: root, stdio: 'ignore' }).status === 0

/** Fails closed: only npm's own 404 counts as free, so a network error never reads as "not yet published". */
const published = (spec: string) => {
  const result = spawnSync('npm', ['view', spec, 'version'], { cwd: root, encoding: 'utf8' })
  // npm 11 answers E404 for a missing version, but an npm that answers 0 with nothing printed means the same.
  if (result.status === 0) return result.stdout.trim() !== ''
  assert.match(result.stderr, /E404/, `npm view ${spec} failed\n${result.stderr}`)
  return false
}

const releaseBase = (version: string) => {
  assert.ok(isVersion(version), `${version} is not a version`)
  // Untracked files reach neither the commit, the tag nor the build, which stages committed files only.
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'the working tree has uncommitted changes')
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'a release is cut from main')
  // Fetch only main: remote tags must be checked without creating local tags before a refusal.
  git('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main')
  assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'refs/remotes/origin/main'), 'main must equal freshly fetched origin/main')
  assert.equal(git('tag', '--list', `v${version}`), '', `the tag v${version} exists`)
  assert.equal(git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`), '', `the tag v${version} exists on origin`)
}

const bump = (version: string) => {
  releaseBase(version)
  const branch = `release/v${version}`
  assert.equal(git('branch', '--list', branch), '', `the branch ${branch} exists`)
  assert.equal(git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`), '', `the branch ${branch} exists on origin`)
  assert.ok(!published(`@drhomet/mithaq@${version}`), `@drhomet/mithaq@${version} is on npm`)
  // The changelog entry becomes the GitHub release's notes, so a release without one stops here.
  const changelogFile = join(root, 'CHANGELOG.md')
  const changelog = releaseChangelog({ changelog: readFileSync(changelogFile, 'utf8'), version })
  // The one version apps/pack.ts stamps on all four staged packages.
  const file = join(root, 'packages/mithaq/package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { publishConfig: { version: string } }
  manifest.publishConfig.version = version
  git('switch', '-c', branch)
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(changelogFile, changelog)
  git('commit', '--quiet', '-m', `The packages are at version ${version}.`, '--', file, changelogFile)
  // Changelog text is untrusted shell input, including quotes, substitutions and newlines.
  const body = `'${changelogSection({ changelog, heading: version })!.replaceAll("'", "'\\''")}'`
  console.log(`Prepared ${branch}. To open its pull request (POSIX shell):\n  git push -u origin ${branch}\n  gh pr create --base main --head ${branch} --title 'Release v${version}' --body ${body}`)
}

const tag = (version: string) => {
  releaseBase(version)
  const manifest = JSON.parse(readFileSync(join(root, 'packages/mithaq/package.json'), 'utf8')) as { publishConfig: { version: string } }
  assert.equal(manifest.publishConfig.version, version, `publishConfig.version must be ${version}`)
  assert.ok(changelogSection({ changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), heading: version }), `CHANGELOG.md has no entries under "## ${version}"`)
  git('tag', '-a', `v${version}`, '-m', `v${version}`)
  console.log(`Tagged v${version} on main. To release it:\n  git push origin v${version}`)
}

const publish = () => {
  const packages = ['mithaq-rich-text', 'mithaq', 'mithaq-admin', 'create-mithaq'].map((dir) => {
    const { name, version } = JSON.parse(readFileSync(join(root, '.pack', dir, 'package.json'), 'utf8')) as { name: string; version: string }
    return { dir: join(root, '.pack', dir), name, version: taggedVersion({ ref: process.env.GITHUB_REF_NAME, version }) }
  })
  const version = packages[0]!.version
  const tag = distTag(version)
  // The tag ruleset decides who tags; this keeps a tag on an unreviewed branch from publishing.
  assert.ok(succeeds('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']), `v${version} is not on main`)

  // Checked before anything ships, so a tag without a changelog entry publishes nothing.
  const entry = changelogSection({ changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), heading: version })
  assert.ok(entry, `CHANGELOG.md has no entries under "## ${version}"`)
  const notes = join(root, '.pack/release-notes.md')
  writeFileSync(notes, `${entry}\n`)

  // Shared rich text first, then core, admin and the starter, so their exact dependencies exist before they ship. A package already at the version
  // is skipped, so a run that failed partway finishes the rest when it is re-run.
  for (const { dir, name } of packages) {
    if (published(`${name}@${version}`)) {
      console.log(`${name}@${version} is on npm already`)
      continue
    }
    // No lifecycle scripts: the publish job holds the OIDC token and runs no code but this file and npm.
    execFileSync('npm', ['publish', dir, '--access', 'public', '--tag', tag, '--ignore-scripts'], { cwd: root, stdio: 'inherit' })
  }
  console.log(`published ${version} as ${tag}; notes in ${notes}`)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const [argument, version] = args
  assert.ok(argument && args.length === (argument === '--tag' ? 2 : 1), 'usage: node apps/release.ts <version> | --tag <version> | --publish')
  if (argument === '--publish') publish()
  else if (argument === '--tag') {
    assert.ok(version, '--tag needs a version')
    tag(version)
  }
  else bump(argument)
}
