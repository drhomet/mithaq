import { defaultFields, globalTypeLabel } from '../base/fields.ts'
import { sortableFields, type LabelFunction, type Localized, type ResolvedKayan } from './types.ts'
import type { Language } from './language.ts'
import { providerOf } from '../base/rules.ts'

/** What one key resolves to: a record per locale, which is checked, or a function or string, which nothing can verify. */
export type Copy = Localized | LabelFunction | string

/** One generated file: the keys one scope claims, and where its file goes. */
export type MessageScope = {
  name: string
  /** The path the scope named, if it named one, in place of the default. */
  out?: string
  keys: Record<string, Copy>
  /** The `mithaq` scope key each seeded key is written from, so a run tells an entry nobody edited from one a person wrote. */
  seeds?: Record<string, string>
}

/** The shape a project's own resolver returns, keyed by the shipped copy's own keys, so a forgotten kind is a type error. */
export type ProjectMessages<L extends Language = Language> = {
  kinds: { [Name in keyof L['kinds']]: string }
  fields: { [Name in keyof typeof defaultFields]: string }
  globalType: string
}

/**
 * The project's resolver. Its parameter is typed `never`, so a project annotates it with any
 * argument; mithaq calls it with nothing and uses what comes back.
 */
export type MessagesResolver<L extends Language = Language> = (context: never) => ProjectMessages<L>

/** Every scope of one build, with the keys two scopes both claim named. */
export type MessageRegistry = {
  /** The locales the language declared, in the order it declared them. */
  locales: readonly string[]
  scopes: readonly MessageScope[]
  /** One entry per key more than one scope claims, naming each claim. */
  collisions: Record<string, readonly string[]>
  /** Whether the project handed `buildAsas` a resolver at all. */
  resolved: boolean
  /** Every localized field of the build, so `--check` can find rows written before a locale was added. */
  localized: readonly { kayan: string; store: string; field: string; sort: string | undefined }[]
}

// One refusal sentence per rule and per kind, which every per-field key is seeded
// from, so a new locale costs one sentence per rule and kind, not one per field.
const floorKeys = (language: Language, kayanList: readonly ResolvedKayan[]): Record<string, Copy> => ({
  ...Object.fromEntries(Object.entries(language.kinds).map(([name, kind]) => [`kinds.${name}`, kind.label])),
  ...Object.fromEntries(
    Object.entries(defaultFields)
      .filter(([, field]) => field.label)
      .map(([name, field]) => [`fields.${name}`, field.label as Copy]),
  ),
  globalType: globalTypeLabel,
  ...(kayanList.some((kayan) => kayan.storage?.maxUnattached !== undefined) && { 'error.invalid.upload_limit': {
    en: 'Attach or remove an upload before uploading another. The limit is {limit}.',
    ar: 'أرفق ملفا مرفوعا أو احذفه قبل رفع ملف آخر. الحد هو {limit}.',
  } }),
  ...Object.fromEntries(
    Object.entries(language.rules)
      .filter(([, rule]) => rule.message)
      .map(([name, rule]) => [`rules.${name}`, rule.message as Copy]),
  ),
  ...Object.fromEntries(Object.entries(language.kinds).map(([name, kind]) => [`kinds.${name}.invalid`, kind.message])),
})

/**
 * The scopes one build writes, and the keys two scopes both claim. Narrowest first: a field's
 * `label`, the kayan's `messages`, the project's resolver, then the shipped copy.
 */
export const messagesOf = ({
  language,
  kayanList,
  resolver,
}: {
  language: Language
  kayanList: readonly ResolvedKayan[]
  resolver?: MessagesResolver
}): MessageRegistry => {
  const scopes: MessageScope[] = [{ name: 'mithaq', keys: floorKeys(language, kayanList) }]
  const collisions: Record<string, readonly string[]> = {}
  for (const kayan of kayanList) {
    // No prototype, so no field or operation name finds an inherited answer.
    const keys: Record<string, Copy> = Object.create(null)
    const seeds: Record<string, string> = Object.create(null)
    const claims: Record<string, string[]> = Object.create(null)
    const claim = (key: string, from: string, copy: Copy) => {
      ;(claims[key] ??= []).push(from)
      // The field wins where both claim one, which is the narrowest-first rule.
      keys[key] ??= copy
    }
    for (const [name, field] of Object.entries(kayan.fields)) {
      if (field.description) claim(`${name}.description`, `field "${name}" description`, field.description)
      if (field.placeholder) claim(`${name}.placeholder`, `field "${name}" placeholder`, field.placeholder)
      // A label mithaq ships is the same object as the floor's, so only a label this kayan declared is its own claim.
      if (!field.label || field.label === (defaultFields as Record<string, { label?: Copy }>)[name]?.label || field.label === globalTypeLabel) continue
      claim(name, `field "${name}" label`, field.label)
    }
    // Screens share this fallback key, so the first description is claimed once.
    const describe = (screen: string) => (kayan.targets?.[screen] as { description?: Copy } | undefined)?.description
    const described = Object.keys(language.targets).find((screen) => language.targets[screen]!.capability === 'screen' && describe(screen))
    if (described) claim('page.description', `screen "${described}" description`, describe(described)!)
    // Claimed once per field however many screens ask for it.
    for (const [name, operation] of Object.entries(kayan.operations)) {
      const fields = Object.entries(operation.targets ?? {}).flatMap(([screen, block]) =>
        (language.targets[screen] as { capability?: string } | undefined)?.capability === 'screen' ? Object.entries(block?.fields ?? {}) : [],
      )
      for (const [field, declared] of fields) {
        const key = `operations.${name}.${field}`
        if (declared.label && !(key in keys)) claim(key, `operation "${name}" field "${field}" label`, declared.label)
      }
    }
    for (const [key, copy] of Object.entries((kayan.messages ?? {}) as Record<string, Copy>)) {
      claim(key, 'messages', copy)
    }
    // A floor rather than a claim, so a kayan's `messages` may override a seeded key
    // without a `--check` collision.
    for (const [name, field] of Object.entries(kayan.fields)) {
      // A field whose shape a target replaced gets none: mithaq built no shape for it. Neither
      // does one the client supplies on neither write, since no refusal can name it.
      if (field.targets?.[kayan.schema] || (field.name !== 'id' && providerOf(field, 'create') !== 'client' && providerOf(field, 'update') !== 'client')) continue
      const seed = (key: string, from: string, message: Copy) => {
        if (key in keys) return
        keys[key] = message
        seeds[key] = from
      }
      seed(`${name}.invalid`, `kinds.${field.kind}.invalid`, language.kinds[field.kind]!.message)
      for (const rule of Object.keys(field.rules ?? {})) {
        // Only a rule that can refuse a value: any other key is one no refusal asks for and
        // every locale pays a translator for.
        const message = language.rules[rule]!.message
        if (message) seed(`${name}.${rule}`, `rules.${rule}`, message)
      }
    }
    for (const [key, from] of Object.entries(claims)) {
      if (from.length > 1) collisions[`${kayan.name}.${key}`] = from
    }
    // A kayan named `mithaq` or `project` is refused at `resolve`, since the generator finds these scopes by name.
    if (Object.keys(keys).length) scopes.push({ name: kayan.name, out: kayan.out, keys, seeds })
  }
  if (resolver) {
    const returned = (resolver as () => ProjectMessages)()
    const keys: Record<string, Copy> = { globalType: returned.globalType }
    for (const [name, copy] of Object.entries(returned.kinds ?? {})) keys[`kinds.${name}`] = copy
    for (const [name, copy] of Object.entries(returned.fields ?? {})) keys[`fields.${name}`] = copy
    scopes.push({ name: 'project', keys })
  }
  const localized = kayanList.flatMap((kayan) =>
    Object.values(kayan.fields)
      .filter((field) => field.rules?.localized)
      .map((field) => ({
        kayan: kayan.name,
        store: kayan.store,
        field: field.name,
        // `undefined` where no field can sort a page, and the scan refuses that by name.
        sort: sortableFields(kayan)[0],
      })),
  )
  return { locales: language.locales ?? [], scopes, collisions, resolved: !!resolver, localized }
}
