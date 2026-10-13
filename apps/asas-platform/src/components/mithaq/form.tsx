import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useForm, useStore, type AnyFormApi } from '@tanstack/react-form'
import type { ClientField, ClientKayan, LeafClient } from 'mithaq/admin'
import { FormContext, ScreenContext } from 'mithaq/admin/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cellFor, useComponents } from './components.tsx'
import type { FindApi } from './control-props.ts'
import { descriptionOf, labelFor, operationLabelFor, titleOf, type Translate } from './copy.ts'
import { DeleteButton } from './delete-button.tsx'
import { DiscardDialog } from './discard-dialog.tsx'
import { DraftBanner } from './draft-banner.tsx'
import { BoundField, FieldValue } from './field-value.tsx'
import { readOnlyField, seedOf, valuesOf } from './field-values.ts'
import { FormActions, ViewSwitch, type DraftStatus } from './form-actions.tsx'
import { KayanForm } from './form-context.tsx'
import { brokenRule, issuesOf, refusalOf, refusalWords } from './form-rules.tsx'
import { LeafControl, NavLinks, NodeButton, OwnButton, rowWarning, drawNodes, drawsKind, frameOf, leavesOf, nodesOf, pageButtonOf, pageOf, refOf, scopeOf, type Draw, type Node, type PageButton, type ScreenPage } from './nodes.tsx'
import { OperationButton } from './operation-button.tsx'
import { localesOf, refusalKeyOf } from './refusal.ts'
import { useRelationshipTitles } from './relationship-cell.tsx'

/**
 * The three operations this screen drives, typed structurally so a typed oRPC client, an in-process
 * router client or a plain object fits.
 */
export type FormClient = {
  create: (input: Record<string, unknown>, options?: DraftOptions) => Promise<unknown>
  update: (input: Record<string, unknown>, options?: DraftOptions) => Promise<unknown>
  delete: (input: Record<string, unknown>) => Promise<unknown>
  /** A kayan's own operation, by name, for a page button that asks for one. A host that hands none draws no such button. */
  run?: (operation: string, input: Record<string, unknown>) => Promise<unknown>
  /** The plain read of one row; on a kayan that keeps drafts, the published copy. A host that hands none draws no draft switch. */
  findByID?: (input: Record<string, unknown>) => Promise<unknown>
}

/** What a write asks beside its input on a kayan that keeps drafts: a draft save, and an autosave beside it. */
export type DraftOptions = { readonly draft?: boolean; readonly autosave?: boolean }

const afterDraft = (status?: DraftStatus): DraftStatus => (status === 'published' || status === 'changed' ? 'changed' : 'draft')

export type FormProps = {
  kayan: ClientKayan
  client: FormClient
  /** The row being edited, or nothing for a row being written. */
  value?: Record<string, unknown> | null
  t: Translate
  locale: string
  /** Which locales exist, from the host: a localized field draws one box for each. */
  locales?: readonly string[]
  /**
   * What the host does once a write lands. The second argument is the effect that ran (`create`,
   * `update` or `delete`), which decides where the host lands.
   */
  onDone: (row: unknown, effect?: string) => void
  /** Where Cancel goes. A host that hands none gets no Cancel button. */
  onCancel?: () => void
  /** A refusal the host already caught, for a host that writes on its own path too. */
  error?: unknown
  /** Every kayan of the build, so a relationship control can find its target. */
  kayans?: readonly ClientKayan[]
  /** The typed client's reads, for a control that pages a second kayan. */
  api?: FindApi
  /**
   * Whether this actor may write one field on the operation being rendered. Chrome only: the server
   * authorizes the write whatever this says. Undeclared is allowed.
   */
  writes?: (field: string, on: 'create' | 'update') => boolean
  /**
   * This actor's answer per operation name. A button for a kayan's own operation reads its own name
   * here, never its effect's. Chrome only; an absent key is denied.
   */
  operations?: Readonly<Record<string, boolean>>
  /**
   * Whether this form holds a change nobody saved, reported each time the answer changes, so the
   * host's router can block a navigation away.
   */
  onDirty?: (dirty: boolean) => void
  /**
   * A navigation the host's router held back while this form reported a change. The form asks the
   * discard question itself so the autosave is held while it asks: `proceed` lets the navigation go,
   * `reset` keeps the person here.
   */
  blocked?: { proceed: () => void; reset: () => void }
  /** A screen's page, where this form draws one: its regions go to the page's layout and nothing the page does not name is drawn. */
  screen?: ScreenPage
  /** What the host draws a list node on this page with. A host that hands none draws no list. */
  related?: Draw['list']
  /** The nodes this form draws in place of a page, as one form node and no shell. They win over `screen`'s page. */
  nodes?: readonly Node[]
  /**
   * The kayan keeps drafts and this actor holds its `findVersions`: the form offers Save draft and
   * Publish changes in place of Save, and autosaves a draft after `autosave` ms of stillness.
   * A host that hands none keeps the plain Save.
   */
  drafts?: { status?: DraftStatus; autosave?: number }
  /**
   * The kayan's update takes `expectedUpdatedAt`: an update sends the `updatedAt` this form last read
   * or wrote, so a save over a newer one from another tab is refused 409. On a kayan that keeps
   * drafts it is the latest version's, and an autosave sends it too.
   */
  expectedUpdatedAt?: boolean
  /**
   * The kayan's other operations that take `expectedUpdatedAt`, of `delete` and `restoreVersion`, so
   * a newer draft another person saved is kept.
   */
  expectedUpdatedAtOn?: readonly string[]
}

/**
 * The form screen over one kayan's `create`, `update` and `delete`, holding its values in TanStack Form.
 * It is mounted under a key of the kayan and the row's id, so a host that hands another row gets a form
 * seeded from that row, and a refusal in hand goes with it.
 */
export function Form(props: FormProps): ReactElement {
  const id = String(props.value?.id ?? '')
  // Exception: the row this form's own autosave made on a create. The host's move to its edit page
  // hands that row and the form stays mounted, so nothing typed since is lost.
  const [held, setHeld] = useState<{ id: string; mount: number; made?: string }>({ id, mount: 0 })
  // The made row's id is kept across that move alone, which is how the page knows the row is its own autosave's.
  if (held.id !== id) setHeld(held.id === '' && held.made === id ? { ...held, id } : { id, mount: held.mount + 1 })
  return <FormScreen key={`${props.kayan.name}:${held.mount}`} {...props} made={held.made} onMade={(made) => setHeld((before) => ({ ...before, made }))} />
}

function FormScreen({
  api,
  blocked,
  client,
  drafts,
  error,
  expectedUpdatedAt,
  expectedUpdatedAtOn,
  kayan,
  kayans,
  locale,
  locales,
  made,
  nodes,
  onCancel,
  onDirty,
  onDone,
  onMade,
  operations,
  related,
  t,
  screen,
  value,
  writes,
}: FormProps & { made?: string; onMade: (id: string) => void }): ReactElement {
  const copy = { t, locale, locales }
  const { cells } = useComponents()
  const [refused, setRefused] = useState<unknown>(undefined)
  const [busy, setBusy] = useState(false)
  // Bumped to remount every control and panel, so a panel reads what it shows afresh.
  const [revision, setRevision] = useState(0)
  const reload = () => setRevision((already) => already + 1)
  // Saves landed since mount (plain, draft, publish, autosave), for panels that keep their own history
  // of the row; a draft save never moves `record.updatedAt`.
  const [saves, setSaves] = useState(0)
  // When the last save landed, shown as the row's last update ahead of its own `updatedAt`.
  const [savedAt, setSavedAt] = useState<Date>()
  const noteSave = () => {
    setSaves((already) => already + 1)
    setSavedAt(new Date())
  }
  // The seed is held in state, not read off `value`: a save makes what it wrote the seed before the host
  // reads the row again. `saved` is what the server holds, kept apart because an autosave leaves the seed alone.
  const seeded = (values: Record<string, unknown>, status = drafts?.status, updatedAt = value?.updatedAt) => ({ row: value, values, saved: values, status, updatedAt })
  const [seed, setSeed] = useState(() => seeded(seedOf(kayan.fields, value)))
  // The focused box and its caret when the host handed another row, put back once the new page has
  // drawn it: an autosaved create moves to an edit page whose tree is new.
  const focused = useRef<{ id: string; start: number | null; end: number | null }>(undefined)
  if (seed.row !== value) {
    const box = typeof document === 'undefined' ? null : (document.activeElement as HTMLInputElement | null)
    focused.current = box?.id ? { id: box.id, start: box.selectionStart ?? null, end: box.selectionEnd ?? null } : undefined
    setSeed(seeded(seedOf(kayan.fields, value)))
  }
  useLayoutEffect(() => {
    const was = focused.current
    focused.current = undefined
    if (!was || document.activeElement?.id === was.id) return
    const box = document.getElementById(was.id) as HTMLInputElement | null
    box?.focus()
    if (was.start !== null) box?.setSelectionRange(was.start, was.end)
  }, [seed])
  const form = useForm({ defaultValues: seed.values })
  const values = useStore(form.store, (state) => state.values as Record<string, unknown>)
  // The access report a node's `when` reads as `$user`; none outside a screen.
  const access = useContext(ScreenContext)?.access
  const held = refused === undefined ? error : refused
  const shown = refusalKeyOf(held)
  const issues = issuesOf(held)
  // The wire message is itself a copy key; a key nothing answers is drawn as it arrived, which is what
  // a custom shape that writes none of our keys sends.
  const sentences: Record<string, string> = Object.create(null)
  for (const [name, issue] of Object.entries(issues)) sentences[name] = t(issue, issue) ?? issue
  const byName = new Map(kayan.fields.map((field) => [field.name, field]))
  const banner = shown ? refusalWords({ shown, labels: Object.keys(issues).flatMap((name) => (byName.has(name) ? [labelFor({ kayan, field: byName.get(name)!, copy })] : [])), copy }) : undefined
  // A create that has autosaved its row edits that row from then on, before
  // the host has handed it.
  const id = String(value?.id ?? made ?? '')
  // A row with an id is being changed, one without is being made; a field may be the client's on one operation and the server's on the other.
  const on = id ? 'update' : 'create'

  // Put the refusal where TanStack keeps a server's answer (`onServer`), so a project's own control reading
  // `field.state.meta.errors` sees the same sentence the shell draws.
  useEffect(() => {
    // The slot is typed off an `onServer` validator, which this form declares none of; TanStack
    // writes the key anyway, so the cast only bridges the types.
    form.setErrorMap({ onServer: { form: undefined, fields: sentences } } as Parameters<AnyFormApi['setErrorMap']>[0])
  }, [form, JSON.stringify(sentences)])

  // TanStack's per-field `isDefaultValue` over the whole form, so a value typed back to its seed is no change.
  const dirty = useStore(form.store, (state) => !state.isDefaultValue)

  // Guards a half-written row against a closed tab or a typed URL. The browser shows its own sentence;
  // cleared on unmount so a form left behind does not hold the guard for the next screen.
  useEffect(() => {
    window.onbeforeunload = dirty ? () => '' : null
    return () => {
      window.onbeforeunload = null
    }
  }, [dirty])

  // The same fact to the host, for navigations the browser's guard cannot see; cleared on unmount so a
  // form left behind does not hold the host's blocker.
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])

  // Whether the server owns this field on this operation (read-only, `uuid`, a non-client provider, or
  // access denied); it decides both the disabled control and whether the field is in the write.
  const owned = (field: ClientField) => readOnlyField(field, on) || (writes ? !writes(field.name, on) : false)
  // Every field `setValue` changed, which a save counts as named.
  const set = useRef(new Set<string>())
  const setValue = (name: string, next: unknown) => {
    const field = byName.get(name)
    if (!busy && !viewing && field && !owned(field)) {
      set.current.add(name)
      form.setFieldValue(name, next)
    }
  }
  // A field the server provides is not the person's to fix, so it is not checked, as the save does not check it.
  const check = (name: string, next: unknown) => {
    const field = byName.get(name)
    const rule = field && !owned(field) ? brokenRule(field, next) : undefined
    if (!rule) return undefined
    const key = `${kayan.name}.${name}.${rule}`
    return t(key, key) ?? key
  }
  // Once the refusal names no field it is `null`, not `undefined`, so the host's own refusal does not come back.
  const forget = (name: string) => {
    if (issues[name] === undefined) return
    const { data } = held as { data: { params: { issues: { path?: unknown }[] } } }
    const rest = data.params.issues.filter((issue) => String(issue.path).split('.')[0] !== name)
    setRefused(rest.length ? { ...(held as object), data: { ...data, params: { ...data.params, issues: rest } } } : null)
  }
  const readOnly = (field: ClientField) => busy || owned(field)

  // A leaf in another region is outside the page's one <form>, so its box names the form by this id
  // (the platform's `form` attribute) and Enter in it still saves.
  const formId = useId()
  const control = (leaf: string | LeafClient) => {
    const field = byName.get(typeof leaf === 'string' ? leaf : leaf.field)
    // A leaf naming a field the kayan lacks is refused at `buildAsas`, so this fires only for a hand-built
    // layout. A field the page names is drawn whoever provides it.
    if (!field) return null
    // The published copy is drawn read-only; the draft's boxes are not drawn, but what was typed stays in the form's values.
    if (viewing) {
      return (
        <LeafControl
          key={`${field.name}-published`}
          field={field}
          form={formId}
          kayan={kayan}
          kayans={kayans}
          leaf={typeof leaf === 'string' ? undefined : leaf}
          screen={screen}
          copy={copy}
          api={api}
          value={showing[field.name]}
          values={showing}
          setValue={() => {}}
          onChange={() => {}}
          readOnly
        />
      )
    }
    // A leaf the page marks read-only is read as text with its cell's formatter. A field the server
    // provides keeps its control, which the side card draws.
    if (typeof leaf !== 'string' && leaf.readOnly === true) {
      return <FieldValue key={`${field.name}-${revision}`} api={api} copy={copy} field={field} kayan={kayan} kayans={kayans} leaf={leaf} row={values} screen={screen} />
    }
    return (
      <BoundField
        key={`${field.name}-${revision}`}
        api={api}
        copy={copy}
        field={field}
        form={formId}
        kayan={kayan}
        kayans={kayans}
        leaf={typeof leaf === 'string' ? undefined : leaf}
        readOnly={readOnly(field)}
        screen={screen}
        values={values}
        setValue={setValue}
      />
    )
  }

  const draw: Draw = {
    kayan,
    copy,
    issues,
    scope: scopeOf({ values, record: value, access, kayan }),
    control,
    // A component has no field behind it; inside a form it reads and writes the form's values through
    // `useForm()`. A reference with no registered component is said, not drawn blank.
    component: (path, index) => {
      const Ref = refOf({ screen, place: 'component', path })
      if (Ref && screen) return <Ref key={`component-${index}-${revision}`} page={screen.page} />
      return (
        <p key={`component-${index}`} data-missing-component={path} className="text-muted-foreground text-sm">
          {(t('admin.missingComponent', 'No component is registered for "{component}".')
            ?? 'No component is registered for "{component}".'
          ).replace('{component}', path)}
        </p>
      )
    },
    layout: ({ path, regions, index }) => screen && frameOf({ screen, t, path, regions, key: index }),
    list: related,
    nav: () => screen && <NavLinks />,
    button: (node) => {
      const button = id && client.run && !viewing ? pageButtonOf({ kayan, node, allowed: operations }) : undefined
      return button ? buttonOf(button) : null
    },
    // The page's one <form>, so a list of another kayan beside it, with forms of its own, is never inside it;
    // a leaf elsewhere on the page is still this form's value. A page with a controls node draws the actions there.
    // `noValidate` so the browser's own bubble never stands in for the field's refusal in the page's language.
    form: (children) => (
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        {chrome}
        <div className={headed ? 'flex flex-col gap-4 border-t pt-6' : 'flex flex-col gap-4'}>
          {children}
          {controlled ? null : (
            <Card>
              <CardContent>{actionsOf(false)}</CardContent>
            </Card>
          )}
        </div>
      </form>
    ),
    // Only while the page draws the form: a role page that draws a fixed role in place of its form offers no save.
    controls: () => (tree && drawsKind({ nodes: tree, kind: 'form', scope: draw.scope }) ? actionsOf(true) : null),
  }
  const walk = (nodes: readonly Node[]) => drawNodes({ nodes, draw })
  // A screen's page names every field it draws; a form handed no page draws every field in declared
  // order, and no join, whose rows are another kayan's.
  const tree = nodes ?? (screen && nodesOf(screen.page))
  const controlled = !!tree && drawsKind({ nodes: tree, kind: 'controls', scope: draw.scope })
  const unnamed = tree ? [] : kayan.fields.filter((field) => field.kind !== 'join')
  const provided = unnamed.filter(owned)
  const rest = unnamed.filter((field) => !owned(field))
  // Titles of the rows the side card points at, read once for this row. With no `api` each id settles as
  // a row the viewer cannot see; the cell never shows the id it holds.
  const titles = useRelationshipTitles({ fields: provided, docs: value ? [value] : [], context: { api, client: kayans, locale } })
  // A page that draws a row draws no kayan description, except a global's one row, whose page is the
  // only place it is drawn.
  const about = screen && value?.id !== undefined && !kayan.single ? undefined : descriptionOf(kayan, copy)
  const headed = !screen || !!about

  const runOperation =
    (operation: PageButton) =>
    async (input: Record<string, unknown>, refuse: (thrown: unknown) => void) => {
      const landed = await run(() => client.run!(operation.name, input), operation.effect, refuse)
      // A kayan's own operation can change anything the row touches, children included, so reload the panels.
      if (landed) reload()
      return landed
    }

  // A relationship is drawn by the list's cell, not a picker: a disabled picker over a row the viewer
  // may not choose shows the raw id, where the cell reads the target's title.
  const sideEntry = (field: ClientField) => {
    if (field.kind !== 'relationship') return control(field.name)
    const Cell = cellFor({ cells, field })
    return (
      <div key={field.name} className="grid gap-1.5">
        <span className="text-sm font-medium">{labelFor({ kayan, field, copy })}</span>
        <span className="text-muted-foreground text-sm">
          <Cell kayan={kayan} field={field} value={values[field.name]} t={t} locale={locale} titles={titles} />
        </span>
      </div>
    )
  }

  /** The instant this form last read or wrote the row at, for a write whose operation takes it. */
  const readAt = (takes?: boolean) => (takes && seed.updatedAt !== undefined ? { expectedUpdatedAt: seed.updatedAt } : {})
  /** Whether a write of the person's own has landed here, which makes a row this page's autosave made theirs. */
  const kept = useRef(false)
  // `refuse` is where a refusal lands: the form's own box by default, or an operation dialog's boxes, which
  // stays open to hold them. Answers whether the write landed.
  const run = async (write: () => Promise<unknown>, effect?: string, refuse: (thrown: unknown) => void = setRefused, status?: DraftStatus): Promise<boolean> => {
    setRefused(undefined)
    setBusy(true)
    try {
      const written = await write()
      kept.current = true
      // What was just written is what the form now holds, so it holds no change: Save goes disabled and
      // the unload guard comes down.
      form.reset(values)
      // The instant the row now stands at, which the next update sends.
      setSeed(seeded(values, status ?? seed.status, (written as { updatedAt?: unknown } | null)?.updatedAt ?? seed.updatedAt))
      noteSave()
      // A write may change the published copy, which View published reads again.
      setPublished(undefined)
      setView('draft')
      onDone(written, effect)
      return true
    } catch (thrown) {
      refusedOver.current = JSON.stringify(values)
      refuse(thrown)
      return false
    } finally {
      setBusy(false)
    }
  }

  // Differs from the seed or from what the server holds since; an update sends only these.
  const changed = (field: ClientField) =>
    form.getFieldMeta(field.name)?.isDefaultValue === false || JSON.stringify(values[field.name]) !== JSON.stringify(seed.saved[field.name])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save()
  }

  // A draft save holds each value to its kind and none of its rules, so the rules are not checked here either.
  const save = (options?: DraftOptions) => {
    // An update sends only the fields that changed, so two people saving different fields of one row each
    // write their own and neither writes the other's back as it was opened.
    const fields = writable().filter((field) => !id || changed(field))
    const refusal = options?.draft ? undefined : refusalOf({ kayan: kayan.name, fields, values })
    if (refusal) return setRefused(refusal)
    const written = valuesOf({ fields, values, owned })
    const status = drafts && (options?.draft ? afterDraft(seed.status) : 'published')
    void run(() => (id ? client.update({ ...written, ...readAt(expectedUpdatedAt), id }, options) : client.create(written, options)), on, undefined, status)
  }

  const writable = () => {
    // A page's form writes only what the page names and draws writable: sending a field it leaves out would
    // overwrite whatever was saved since. A field a control or panel set through `setValue` counts as named.
    const named = tree && new Set([...leavesOf(tree, (leaf) => !leaf.readOnly), ...set.current])
    return (named ? kayan.fields.filter((field) => named.has(field.name)) : kayan.fields).filter((field) => !owned(field))
  }

  const status = drafts && seed.status
  // Which copy a changed row shows: the draft, or the published copy, read once when first chosen and drawn read-only with no save or autosave.
  const [view, setView] = useState<'draft' | 'published'>('draft')
  const [published, setPublished] = useState<Record<string, unknown> | null>()
  const viewing = status === 'changed' && view === 'published' && !!published
  const showing = viewing ? seedOf(kayan.fields, published) : values
  const choose = async (next: string) => {
    if (next === 'published' && published === undefined) {
      try {
        setPublished((await client.findByID!({ id })) as Record<string, unknown> | null)
      } catch (thrown) {
        return setRefused(thrown)
      }
    }
    setView(next === 'published' ? 'published' : 'draft')
  }
  /** The values a save was last refused over, which the autosave below never sends again. */
  const refusedOver = useRef<string | undefined>(undefined)
  const [autosaved, setAutosaved] = useState<'saving' | 'saved'>()
  /** Whether the form is still on screen, which an autosave that lands late asks before it moves the host. */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const json = JSON.stringify(values)
  // Autosave a draft of what differs once the form has stayed still for the interval. Never while a save is out,
  // over values a save was refused over, or while a discard question is open: that question says the change is unsaved.
  const [asking, setAsking] = useState(false)
  /** Whether a Discard is on its way out, deleting a draft first where it has one to delete. */
  const [leaving, setLeaving] = useState(false)
  // Nor once a write was refused because the row changed since this form read it: every autosave after it
  // would be refused the same way, so it stops and the refusal stays to say why.
  const stale = shown === 'error.conflict.stale'
  const interval = viewing || asking || blocked || leaving || stale ? undefined : drafts?.autosave
  useEffect(() => {
    if (!interval || busy || autosaved === 'saving' || refusedOver.current === json) return
    const fields = writable()
    if (!fields.some((field) => JSON.stringify(values[field.name]) !== JSON.stringify(seed.saved[field.name]))) return
    const timer = setTimeout(() => {
      const sent = valuesOf({ fields: fields.filter((field) => !id || changed(field)), values, owned })
      setAutosaved('saving')
      const words = { draft: true, autosave: true }
      ;(id ? client.update({ ...sent, ...readAt(expectedUpdatedAt), id }, words) : client.create(sent, words)).then(
        (written) => {
          setAutosaved('saved')
          // A refusal a save drew earlier is over: the row just saved fine, so a banner naming no field
          // would sit there with nothing left to say.
          setRefused(undefined)
          refusedOver.current = undefined
          noteSave()
          // The instant the draft now stands at, which the next write sends.
          const updatedAt = (written as { updatedAt?: unknown } | null)?.updatedAt ?? seed.updatedAt
          if (JSON.stringify(form.state.values) === json) {
            form.reset(values)
            setSeed(seeded(values, afterDraft(seed.status), updatedAt))
          } else {
            setSeed((held) => ({ ...held, saved: { ...held.saved, ...sent }, status: afterDraft(held.status), updatedAt }))
          }
          const row = (written as { id?: unknown } | null)?.id
          if (!id && row !== undefined && alive.current) {
            onMade(String(row))
            onDone(written, 'create')
          }
        },
        (thrown: unknown) => {
          refusedOver.current = json
          setAutosaved(undefined)
          setRefused(thrown)
        },
      )
    }, interval)
    return () => clearTimeout(timer)
  }, [interval, busy, autosaved, json, seed, id])
  // Leaving unsaved deletes the untouched draft this page's autosave made, so a cancelled new row leaves none.
  // A published row is kept (a plain read finds it), and so is a draft someone saved since (the delete gets a 409).
  const ownDraft = !!made && id === made && !kept.current && status === 'draft'
  const keepsDraft = ownDraft && operations?.delete !== true
  const out = useRef(false)
  const discard = async (leave: () => void) => {
    if (out.current) return
    out.current = true
    setLeaving(true)
    if (ownDraft && !keepsDraft && client.findByID) {
      const found = await client.findByID({ id }).then(
        (row) => (row ? 'published' : 'absent'),
        (thrown: unknown) => ((thrown as { status?: unknown } | null)?.status === 404 ? 'absent' : 'unknown'),
      )
      if (found === 'absent') await client.delete({ id, ...readAt(expectedUpdatedAtOn?.includes('delete')) }).catch((thrown: unknown) => console.error('The draft this page made could not be deleted:', thrown))
    }
    // The edit is thrown away before the navigation, so a slow navigation leaves no change for the autosave to save.
    form.reset(seed.saved)
    out.current = false
    setLeaving(false)
    setAsking(false)
    leave()
  }
  useEffect(() => {
    if (autosaved !== 'saved') return
    const timer = setTimeout(() => setAutosaved(undefined), 2000)
    return () => clearTimeout(timer)
  }, [autosaved, saves])

  const buttonOf = (operation: PageButton) => {
    const Ref = refOf({ screen, place: 'button', path: operation.component })
    if (Ref && screen) {
      return (
        <OwnButton
          key={operation.name}
          Own={Ref}
          operation={operation}
          busy={busy}
          copy={copy}
          call={async (input) => {
            await runOperation(operation)({ ...input, id }, setRefused)
          }}
        />
      )
    }
    // A delete is the one write nothing brings back, so its button is always the two-step dialog, whatever the node carries.
    if (operation.effect === 'delete') {
      return (
        <DeleteButton
          key={operation.name}
          busy={busy}
          copy={copy}
          kayan={kayan}
          label={operationLabelFor({ kayan, operation, copy })}
          row={value ?? undefined}
          onDelete={(refuse) => run(() => client.delete({ id }), 'delete', refuse)}
        />
      )
    }
    // A button that asks for no values and carries a confirm asks it in the app's own dialog; any other opens the
    // registry's dialog, which asks the confirm in its heading. Each names the row it runs on.
    const description = value ? rowWarning({ kayan, row: value, operation: operation.name, copy }) : undefined
    if (operation.confirm && !operation.fields?.length) {
      return <NodeButton key={operation.name} node={operation} copy={copy} busy={busy} description={description} run={() => void runOperation(operation)({ id }, setRefused)} />
    }
    return (
      <OperationButton
        key={operation.name}
        api={api}
        busy={busy}
        copy={copy}
        description={description}
        inputOf={(values) => ({ id, ...values })}
        kayan={kayan}
        kayans={kayans}
        operation={operation}
        run={runOperation(operation)}
      />
    )
  }
  const updated = id ? (savedAt ?? (value?.updatedAt ? new Date(value.updatedAt as string | Date) : undefined)) : undefined
  // The draft or the published copy, on a changed row only. Beside the actions from xl up; below xl a row at
  // the top of the form (`chrome`), so it is never in the phone's fixed bar.
  const views = status === 'changed' && client.findByID ? { viewing, choose } : undefined
  const actionsOf = (header: boolean) => (
    <FormActions
      autosaved={autosaved}
      banner={banner}
      busy={busy}
      dirty={dirty}
      drafts={!!drafts}
      formId={formId}
      header={header}
      locale={locale}
      onAsk={() => setAsking(true)}
      onCancel={onCancel}
      onSaveDraft={() => save({ draft: true })}
      status={status}
      t={t}
      updated={updated}
      updating={!!id}
      viewing={viewing}
      views={views}
    />
  )
  // On a screen's page the title is the page's own `title` node, so the form keeps only the sentence under it.
  const chrome = (
    <>
    {/* On a screen's page a kayan with no sentence draws no header and no rule under it. */}
    {headed ? (
      <header className="max-w-3xl">
        {screen ? null : <h1 className="text-2xl font-bold tracking-tight">{titleOf({ kayan, copy })}</h1>}
        {about ? <p className="text-muted-foreground mt-1 text-sm">{about}</p> : null}
      </header>
    ) : null}
    {shown && !controlled ? (
      <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
        {banner}
      </p>
    ) : null}
    {controlled && views ? <ViewSwitch className="xl:hidden" phone {...views} t={t} /> : null}
    {status === 'changed' ? (
      <DraftBanner
        busy={busy || autosaved === 'saving'}
        onRestore={operations?.restoreVersion === true && client.run ? () => void run(() => client.run!('restoreVersion', { id, ...readAt(expectedUpdatedAtOn?.includes('restoreVersion')) }), 'update', undefined, 'published') : undefined}
        onViewPublished={client.findByID ? () => void choose('published') : undefined}
        t={t}
        viewing={viewing}
      />
    ) : null}
    </>
  )
  return (
    // The provider is around the whole screen, not just the column of inputs, so a panel the project
    // registered binds a field of this form through `useKayanField` wherever the layout put it.
    <KayanForm.Provider value={{ check, forget, form, issues: sentences, locales: localesOf(held), on, writes }}>
      <FormContext value={{ getData: () => showing, setValue, disabled: busy || viewing, saves, expectedUpdatedAtOn }}>
      {/* One question for both ways out, Cancel and a blocked navigation,
          kept mounted so nothing but an answer closes it. */}
      <DiscardDialog
        t={t}
        busy={busy || autosaved === 'saving' || leaving}
        open={asking || !!blocked}
        note={keepsDraft ? (t('admin.discardKeepsDraft', 'The draft saved so far is kept.') ?? 'The draft saved so far is kept.') : undefined}
        onOpenChange={(open) => {
          if (open || leaving) return
          setAsking(false)
          blocked?.reset()
        }}
        onDiscard={() => void discard(blocked ? blocked.proceed : onCancel ?? (() => {}))}
      />
      {nodes || screen ? (
      <div className="flex flex-1 flex-col gap-6">{nodes ? walk([{ form: [...nodes] }]) : pageOf(screen!, draw)}</div>
      ) : (
      <form id={formId} noValidate onSubmit={submit} className="flex flex-1 flex-col gap-6">
      {chrome}
      <div className="border-t pt-6">
        <div className={provided.length ? 'grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]' : 'max-w-3xl'}>
          {/* A div and not a `main`: the page's shell already holds the one main landmark. */}
          <div data-fields="" className="grid min-w-0 gap-4">
            <Card className="overflow-visible">
              <CardContent className="flex flex-col gap-4">
                {rest.length ? <div className="flex flex-col gap-4">{rest.map((field) => control(field.name))}</div> : null}
                {actionsOf(false)}
              </CardContent>
            </Card>
          </div>
          {provided.length ? (
            <aside className="grid h-fit gap-4 lg:sticky lg:top-20">
              <Card className="overflow-visible rounded-lg">
                <CardHeader>
                  <CardTitle>
                    <h2 className="text-base font-medium">{t('admin.record', 'Record') ?? 'Record'}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">{provided.map(sideEntry)}</CardContent>
              </Card>
            </aside>
          ) : null}
        </div>
      </div>
      </form>
      )}
      </FormContext>
    </KayanForm.Provider>
  )
}
// mithaq-admin 7fc64834f9ec8682c4c34f35d23a21736cf89a50 22f84a8ca4cf078200ca8886bbe699f6a512757ba8715b7daf2b055718679fa4
