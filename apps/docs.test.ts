// The guides stay true to the repository: every link resolves, no retired name is left, and each snippet a guide marks
// as copied from a file still appears in it. CONTRIBUTING.md, "Docs", says how a snippet is marked.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter((file) => file && existsSync(join(root, file)))
const guides = tracked.filter((file) => file.endsWith('.md')).map((file) => ({ file, lines: readFileSync(join(root, file), 'utf8').split('\n') }))

/** Each line outside a fenced block, with its number, and inline code blanked, so an example in code is never read as a link. */
const prose = (lines: string[]) => {
  let fenced = false
  return lines.flatMap((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced
    return fenced || /^\s*```/.test(line) ? [] : [{ line: line.replaceAll(/`[^`]*`/g, '``'), number: index + 1, raw: line }]
  })
}

/** The anchors GitHub gives a file's headings: lowercased, punctuation dropped, spaces as hyphens, a repeat numbered. */
const anchorsOf = (file: string) => {
  const seen = new Map<string, number>()
  return new Set(prose(readFileSync(join(root, file), 'utf8').split('\n')).flatMap(({ raw }) => {
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(raw)?.[1]
    if (heading === undefined) return []
    const slug = heading.replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase().replaceAll(/[^\p{L}\p{N}\s_-]/gu, '').replaceAll(' ', '-')
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return [count ? `${slug}-${count}` : slug]
  }))
}

test('every relative link, anchor and link to this repository on GitHub in a tracked Markdown file resolves', () => {
  const broken: string[] = []
  for (const { file, lines } of guides) {
    for (const { line, number } of prose(lines)) {
      for (const [, target] of line.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
        const own = /^https:\/\/github\.com\/drhomet\/mithaq\/(?:blob|tree)\/main\/([^#?]+)(#.*)?$/.exec(target!)
        if (/^[a-z]+:/.test(target!) && !own) continue
        const [path, anchor] = own ? [own[1]!, own[2]?.slice(1)] : target!.split('#') as [string, string | undefined]
        const at = path === '' ? file : own ? path : normalize(join(dirname(file), decodeURI(path)))
        if (!existsSync(join(root, at))) broken.push(`${file}:${number} ${target}`)
        else if (anchor && at.endsWith('.md') && !anchorsOf(at).has(anchor)) broken.push(`${file}:${number} ${target} (no such heading)`)
      }
    }
  }
  assert.deepEqual(broken, [])
})

// A name the project retired, which a guide should no longer teach. The commit that renames something adds the old
// name here. An "Upgrading" section names them on purpose, to say what each became.
const retired = [/admin@admin\.com/, /\bmithaqjs\b/, /\bBun only\b/i, /asas-platform/, /PLATFORM_URL/, /\bscreen\.platform\b/, /platform-roles|platformRoles|platformApp|ui-platform/, /\bplatform (console|app|screen)\b/i, /(^|[\s(`'"])\/?r\/[\w-]+\.json/, /registry\/r\//, /bunfig\.toml/]

/** Each line naming a retired name, as `<line> <name>`, outside an "Upgrading" section; a fenced line opens or closes none. */
const staleIn = (lines: string[]) => {
  const headings = new Map(prose(lines).flatMap(({ raw, number }) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw)
    return heading ? [[number, heading] as const] : []
  }))
  let upgrading = false
  return lines.flatMap((line, index) => {
    const heading = headings.get(index + 1)
    if (heading) upgrading = heading[1]!.length <= 2 ? /upgrading/i.test(heading[2]!) : upgrading
    return upgrading ? [] : retired.filter((name) => name.test(line)).map((name) => `${index + 1} ${name}`)
  })
}

test('no guide teaches a retired name outside the notes on upgrading', () => {
  assert.deepEqual(guides.flatMap(({ file, lines }) => staleIn(lines).map((one) => `${file}:${one}`)), [])
})

test('a heading inside a fenced block neither opens nor closes the notes on upgrading', () => {
  const lines = ['# Guide', '```sh', '## Upgrading', '```', 'PLATFORM_URL', '## Upgrading', '```sh', '# a comment', '```', 'PLATFORM_URL', '## Next', 'PLATFORM_URL']
  assert.deepEqual(staleIn(lines), ['5 /PLATFORM_URL/', '12 /PLATFORM_URL/'])
})

test('every skill opens with the frontmatter Claude Code reads: its folder\'s name and a description', () => {
  for (const { file, lines } of guides.filter(({ file }) => file.endsWith('/SKILL.md'))) {
    const name = /\/skills\/([^/]+)\/SKILL\.md$/.exec(file)![1]
    assert.deepEqual([lines[0], lines[1], /^description: \S/.test(lines[2]!) || lines[2] === 'description: >'], ['---', `name: ${name}`, true], file)
  }
})

test('each snippet a guide marks as copied from a file still appears in that file, line by line in order', () => {
  const drifted: string[] = []
  for (const { file, lines } of guides) {
    lines.forEach((line, index) => {
      const from = /^\s*<!-- from: (\S+) -->\s*$/.exec(line)?.[1]
      if (!from) return
      assert.match(lines[index + 1] ?? '', /^\s*```\w*\s*$/, `${file}:${index + 1} marks no snippet: the fence must follow the marker`)
      assert.ok(tracked.includes(from), `${file}:${index + 1} names ${from}, which the repository does not hold`)
      const source = readFileSync(join(root, from), 'utf8').split('\n').map((one) => one.trim())
      let at = 0
      for (let next = index + 2; !/^\s*```\s*$/.test(lines[next]!); next++) {
        const wanted = lines[next]!.trim()
        // A blank line or `// ...` stands for what the snippet leaves out.
        if (wanted === '' || wanted === '// ...') continue
        const found = source.indexOf(wanted, at)
        if (found === -1) {
          drifted.push(`${file}:${next + 1} is not in ${from} after line ${at}: ${wanted}`)
          break
        }
        at = found + 1
      }
    })
  }
  assert.deepEqual(drifted, [])
})
