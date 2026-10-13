// `node apps/release.ts <version>` commits the version and tags it, on a clean main, for the owner to push.
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

/** A plain release's notes cover everything since the last plain release, past its prereleases; a prerelease's, since the last tag. */
export const previousTag = ({ cwd, version }: { cwd: string; version: string }) => {
  const plain = distTag(version) === 'latest' ? ['--exclude', 'v*-*'] : []
  const found = spawnSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*', ...plain, `v${version}^`], { cwd, encoding: 'utf8' })
  return found.status === 0 ? found.stdout.trim() : undefined
}

export const notesRange = ({ previous, tag }: { previous: string | undefined; tag: string }) => (previous ? `${previous}..${tag}` : tag)

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

const bump = (version: string) => {
  assert.ok(isVersion(version), `${version} is not a version`)
  // Untracked files reach neither the commit, the tag nor the build, which stages committed files only.
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'the working tree has uncommitted changes')
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'a release is cut from main')
  assert.ok(!succeeds('git', ['rev-parse', '-q', '--verify', `refs/tags/v${version}`]), `the tag v${version} exists`)
  assert.ok(!published(`@drhomet/mithaq@${version}`), `@drhomet/mithaq@${version} is on npm`)
  // The one version apps/pack.ts stamps on all three staged packages.
  const file = join(root, 'packages/mithaq/package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { publishConfig: { version: string } }
  manifest.publishConfig.version = version
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
  git('commit', '--quiet', '-m', `The packages are at version ${version}.`, '--', file)
  git('tag', '-a', `v${version}`, '-m', `v${version}`)
  // Atomic, so a rejected main leaves no tag on the remote to start a release run.
  console.log(`Tagged v${version}. To release it:\n  git push --atomic origin main v${version}`)
}

const publish = () => {
  const packages = ['mithaq', 'mithaq-admin', 'create-mithaq'].map((dir) => {
    const { name, version } = JSON.parse(readFileSync(join(root, '.pack', dir, 'package.json'), 'utf8')) as { name: string; version: string }
    return { dir: join(root, '.pack', dir), name, version: taggedVersion({ ref: process.env.GITHUB_REF_NAME, version }) }
  })
  const version = packages[0]!.version
  const tag = distTag(version)
  // The tag ruleset decides who tags; this keeps a tag on an unreviewed branch from publishing.
  assert.ok(succeeds('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']), `v${version} is not on main`)

  const range = notesRange({ previous: previousTag({ cwd: root, version }), tag: `v${version}` })
  const notes = join(root, '.pack/release-notes.md')
  writeFileSync(notes, `${git('log', range, '--format=- %s', '--no-merges')}\n`)

  // Core first, so the admin and the starter never name a version of it that is missing. A package already at the version
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
  const [argument] = process.argv.slice(2)
  assert.ok(argument, 'usage: node apps/release.ts <version> | --publish')
  if (argument === '--publish') publish()
  else bump(argument)
}
