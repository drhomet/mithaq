/** A translated leaf, an opaque resolver result, or a function's unverifiable marker. */
export type MessageEntry = Record<string, string> | string | null

type Branch = { [key: string]: MessageEntry | Branch }
const branch = (value: unknown): value is Branch => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Reads both release formats, keeping a parent's own value separate from its children. */
export const flattenMessageFile = ({ file, locales }: { file: Record<string, unknown>; locales: readonly string[] }): Record<string, MessageEntry> => {
  const entries: [string, MessageEntry][] = []
  const walk = (node: Record<string, unknown>, parts: string[]) => {
    for (const [name, value] of Object.entries(node)) {
      const path = [...parts, name]
      if (name === '$value') entries.push([parts.join('.'), value as MessageEntry])
      else if (branch(value) && !(Object.values(value).every((one) => typeof one === 'string') && (!Object.keys(value).length || Object.keys(value).some((key) => locales.includes(key))))) walk(value, path)
      else entries.push([path.join('.'), value as MessageEntry])
    }
  }
  walk(file, [])
  return Object.fromEntries(entries)
}

/** A value gets `$value` only when another key needs to pass through it. */
export const nestMessageFile = (entries: Record<string, MessageEntry>): Branch => {
  const result: Branch = Object.create(null)
  for (const key of Object.keys(entries).sort()) {
    const parts = key.split('.')
    let into = result
    for (let at = 0; at < parts.length - 1; at++) {
      const part = parts[at]!
      const prefix = parts.slice(0, at + 1).join('.')
      if (!Object.hasOwn(into, part)) into[part] = Object.create(null)
      else if (Object.hasOwn(entries, prefix) && (!branch(into[part]) || !Object.hasOwn(into[part], '$value'))) into[part] = Object.assign(Object.create(null), { $value: into[part] as MessageEntry })
      into = into[part] as Branch
    }
    into[parts.at(-1)!] = entries[key]!
  }
  return result
}
