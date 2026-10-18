import type { ClientField, ClientKayan, Translate } from 'mithaq/admin'

export type { Translate }

/** What every screen is handed to resolve copy with. */
export type Copy = {
  t: Translate
  locale: string
  /** Every locale the host reads in, which a localized field draws one box for. */
  locales?: readonly string[]
}

/**
 * A field's label: the record's string for the locale, else the project's copy under `<kayan>.<field>`, else the field name. A label written as a function crosses the projection as nothing, so the key is rebuilt from the two names.
 */
export const labelFor = ({ kayan, field, copy: { t, locale } }: { kayan: ClientKayan; field: ClientField; copy: Copy }): string =>
  (typeof field.label === 'object' ? field.label[locale] : undefined)
  ?? t(`${kayan.name}.${field.name}`, field.name)
  ?? field.name

/** The same chain for a field's description, which is optional everywhere. */
export const descriptionFor = ({ kayan, field, copy: { t, locale } }: { kayan: ClientKayan; field: ClientField; copy: Copy }): string | undefined =>
  (typeof field.description === 'object' ? field.description[locale] : undefined)
  ?? t(`${kayan.name}.${field.name}.description`)

/**
 * The same chain for a field's placeholder, the hint a text-like control shows while empty. A kind whose control has nowhere to draw a hint ignores it.
 */
export const placeholderFor = ({ kayan, field, copy: { t, locale } }: { kayan: ClientKayan; field: ClientField; copy: Copy }): string | undefined =>
  (typeof field.placeholder === 'object' ? field.placeholder[locale] : undefined)
  ?? t(`${kayan.name}.${field.name}.placeholder`)

/**
 * What a kayan is for, in one sentence, resolved like a field's description. `undefined` when the kayan declares none, so a heading is never repeated as its own subtitle.
 */
export const descriptionOf = (kayan: ClientKayan, { t, locale }: Copy): string | undefined =>
  (typeof kayan.description === 'object' ? kayan.description[locale] : undefined)
  ?? t(`${kayan.name}.page.description`)

/**
 * The words on a page's button for a kayan's operation: the page's label for the locale, else the project's copy under `<kayan>.operations.<name>`, else the operation's name.
 */
export const operationLabelFor = ({
  kayan,
  operation,
  copy: { t, locale },
}: {
  kayan: ClientKayan
  operation: { name: string; label?: Readonly<Record<string, string>> }
  copy: Copy
}): string =>
  (typeof operation.label === 'object' ? operation.label[locale] : undefined)
  ?? t(`${kayan.name}.operations.${operation.name}`, operation.name)
  ?? operation.name

/**
 * The words on one box of an operation's dialog, under `<kayan>.operations.<name>.<field>`, so an operation's field and a kayan's field can share a name and never a key.
 */
export const operationFieldLabelFor = ({
  kayan,
  operation,
  field,
  copy: { t, locale },
}: {
  kayan: ClientKayan
  operation: { name: string }
  field: ClientField
  copy: Copy
}): string =>
  (typeof field.label === 'object' ? field.label[locale] : undefined)
  ?? t(`${kayan.name}.operations.${operation.name}.${field.name}`, field.name)
  ?? field.name

/**
 * What a kayan is called: the `singular` or `plural` key of its copy scope, else its name. Takes the name alone, so a shell that hands its browser only a kayan's name can still name it.
 */
export const titleOf = ({ kayan, copy: { t }, many = false }: { kayan: Pick<ClientKayan, 'name'>; copy: Copy; many?: boolean }): string =>
  t(`${kayan.name}.${many ? 'plural' : 'singular'}`, kayan.name) ?? kayan.name

/**
 * What a create page is titled: the kayan's `new` key, else "Create {kind}" with its singular.
 */
export const newTitleOf = ({ kayan, copy }: { kayan: Pick<ClientKayan, 'name'>; copy: Copy }): string =>
  copy.t(`${kayan.name}.new`) ?? (copy.t('admin.createTitle', 'Create {kind}') ?? 'Create {kind}').replace('{kind}', () => titleOf({ kayan, copy }))
