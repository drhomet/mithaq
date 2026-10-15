import { useContext, useId, useState, type FormEvent, type ReactElement } from 'react'
import type { ClientField, LeafClient } from 'mithaq/admin'
import { FormContext, ScreenContext } from 'mithaq/admin/react'
import { Card, CardContent } from '@/components/ui/card'
import { descriptionOf, titleOf } from 'mithaq-admin/copy.ts'
import { DiscardDialog } from 'mithaq-admin/discard-dialog.tsx'
import { BoundField, FieldValue } from 'mithaq-admin/field-value.tsx'
import { readOnlyField } from 'mithaq-admin/field-values.ts'
import { FormActions } from 'mithaq-admin/form-actions.tsx'
import { FormButton } from 'mithaq-admin/form-button.tsx'
import { FormChrome } from 'mithaq-admin/form-chrome.tsx'
import { KayanForm } from 'mithaq-admin/form-context.tsx'
import { FormLayout } from 'mithaq-admin/form-layout.tsx'
import { brokenRule, doneWords, failedWords, issuesOf } from 'mithaq-admin/form-rules.tsx'
import type { FormProps } from 'mithaq-admin/form-types.tsx'
import { LeafControl } from 'mithaq-admin/leaf-control.tsx'
import { NavLinks } from 'mithaq-admin/nav-links.tsx'
import { pageButtonOf, type PageButton } from 'mithaq-admin/node-buttons.tsx'
import { drawsKind, nodesOf, scopeOf, type Draw } from 'mithaq-admin/node-tree.ts'
import { drawNodes, frameOf, pageOf } from 'mithaq-admin/nodes.tsx'
import { localesOf } from 'mithaq-admin/refusal.ts'
import { refOf } from 'mithaq-admin/screen-refs.ts'
import { useAutosave } from 'mithaq-admin/use-autosave.tsx'
import { useDraftView } from 'mithaq-admin/use-draft-view.tsx'
import { useFormRefusal } from 'mithaq-admin/use-form-refusal.tsx'
import { useFormSave } from 'mithaq-admin/use-form-save.tsx'
import { useFormSeed } from 'mithaq-admin/use-form-seed.tsx'
import { toast } from 'mithaq-admin/toast.tsx'

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

function FormScreen(props: FormProps & { made?: string; onMade: (id: string) => void }): ReactElement {
  const { api, blocked, client, drafts, kayan, kayans, locale, nodes, onCancel, operations, screen, t, value, writes } = props
  const copy = { t, locale, locales: props.locales }
  // Bumped to remount every control and panel, so a panel reads what it shows afresh.
  const [revision, setRevision] = useState(0)
  const { seed, setSeed, seeded, form, values, dirty } = useFormSeed({ kayan, value, status: drafts?.status, onDirty: props.onDirty })
  const { held, shown, issues, sentences, banner, setRefused, forget } = useFormRefusal({ copy, error: props.error, form, kayan })
  // A refusal naming a field is drawn at that field; any other, a request that failed, is said in a red toast.
  const refuse = (thrown: unknown) => {
    setRefused(thrown)
    if (thrown && !Object.keys(issuesOf(thrown)).length) toast.error(failedWords({ kayan: kayan.name, copy, thrown }))
  }
  // The access report a node's `when` reads as `$user`; none outside a screen.
  const access = useContext(ScreenContext)?.access
  const byName = new Map(kayan.fields.map((field) => [field.name, field]))
  // A create that has autosaved its row edits that row from then on, before the host has handed it.
  const id = String(value?.id ?? props.made ?? '')
  // A row with an id is being changed, one without is being made; a field may be the client's on one operation and the server's on the other.
  const on = id ? 'update' : 'create'
  // Whether the server owns this field on this operation (read-only, `uuid`, a non-client provider, or
  // access denied); it decides both the disabled control and whether the field is in the write.
  const owned = (field: ClientField) => readOnlyField(field, on) || (writes ? !writes(field.name, on) : false)
  const status = drafts && seed.status
  const { viewing, showing, choose, forget: forgetPublished } = useDraftView({ client, id, kayan, refuse, status, values })
  // A screen's page names every field it draws; a form handed no page draws every field in declared
  // order, and no join, whose rows are another kayan's.
  const tree = nodes ?? (screen && nodesOf(screen.page))
  const saving = useFormSave({ ...props, drafts: !!drafts, form, id, owned, refuse, seed, seeded, setSeed, status, tree, values, onWritten: forgetPublished, done: (landed) => doneWords({ kayan, copy, ...landed }) })
  const { busy, run, save, readAt, asking, setAsking, leaving } = saving
  // Never while a discard question is open, which says the change is unsaved, nor once a write was refused because
  // the row changed since this form read it: every autosave after it would be refused the same way.
  const interval = viewing || asking || blocked || leaving || shown === 'error.conflict.stale' ? undefined : drafts?.autosave
  const autosaved = useAutosave({ ...props, ...saving, client, form, id, interval, owned, readAt: () => readAt(props.expectedUpdatedAt), refuse, seed, seeded, setSeed, values })

  const setValue = (name: string, next: unknown) => {
    const field = byName.get(name)
    if (!busy && !viewing && field && !owned(field)) {
      saving.named.current.add(name)
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

  // A leaf in another region is outside the page's one <form>, so its box names the form by this id
  // (the platform's `form` attribute) and Enter in it still saves.
  const formId = useId()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save()
  }
  const control = (leaf: string | LeafClient) => {
    const field = byName.get(typeof leaf === 'string' ? leaf : leaf.field)
    // A leaf naming a field the kayan lacks is refused at `buildAsas`, so this fires only for a hand-built
    // layout. A field the page names is drawn whoever provides it.
    if (!field) return null
    const shared = { api, copy, field, kayan, kayans, leaf: typeof leaf === 'string' ? undefined : leaf, screen }
    // The published copy is drawn read-only; the draft's boxes are not drawn, but what was typed stays in the form's values.
    if (viewing) return <LeafControl key={`${field.name}-published`} {...shared} form={formId} value={showing[field.name]} values={showing} setValue={() => {}} onChange={() => {}} readOnly />
    // A leaf the page marks read-only is read as text with its cell's formatter. A field the server
    // provides keeps its control, which the side card draws.
    if (shared.leaf?.readOnly === true) return <FieldValue key={`${field.name}-${revision}`} {...shared} row={values} />
    return <BoundField key={`${field.name}-${revision}`} {...shared} form={formId} readOnly={busy || owned(field)} values={values} setValue={setValue} />
  }
  // A kayan's own operation can change anything the row touches, children included, so the panels are remounted after it.
  const runOperation = (operation: PageButton) => async (input: Record<string, unknown>, refuse: (thrown: unknown) => void) => {
    const landed = await run({ write: () => client.run!(operation.name, input), effect: operation.effect, operation, refuse })
    if (landed) setRevision((already) => already + 1)
    return landed
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
          {(t('admin.missingComponent', 'No component is registered for "{component}".') ?? 'No component is registered for "{component}".').replace('{component}', path)}
        </p>
      )
    },
    layout: ({ path, regions, index }) => screen && frameOf({ screen, t, path, regions, key: index }),
    list: props.related,
    nav: () => screen && <NavLinks />,
    button: (node) => {
      const button = id && client.run && !viewing ? pageButtonOf({ kayan, node, allowed: operations }) : undefined
      if (!button) return null
      const onDelete = (refuse: (thrown: unknown) => void) => run({ write: () => client.delete({ id }), effect: 'delete', refuse })
      return <FormButton key={button.name} {...{ api, busy, copy, id, kayan, kayans, onDelete, screen, value }} operation={button} run={runOperation(button)} refuse={refuse} />
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
  const controlled = !!tree && drawsKind({ nodes: tree, kind: 'controls', scope: draw.scope })
  // A page that draws a row draws no kayan description, except a global's one row, whose page is the
  // only place it is drawn.
  const about = screen && value?.id !== undefined && !kayan.single ? undefined : descriptionOf(kayan, copy)
  const headed = !screen || !!about
  const updated = id ? (saving.savedAt ?? (value?.updatedAt ? new Date(value.updatedAt as string | Date) : undefined)) : undefined
  // The draft or the published copy, on a changed row only. Beside the actions from xl up; below xl a row at
  // the top of the form (`chrome`), so it is never in the phone's fixed bar.
  const views = status === 'changed' && client.findByID ? { viewing, choose } : undefined
  const actionsOf = (header: boolean) => (
    <FormActions {...{ autosaved, banner, busy, dirty, formId, header, locale, onCancel, status, t, updated, viewing, views }} drafts={!!drafts} updating={!!id} onAsk={() => setAsking(true)} onSaveDraft={() => save({ draft: true })} />
  )
  // On a screen's page the title is the page's own `title` node, so the form keeps only the sentence under it.
  const chrome = (
    <FormChrome
      headed={headed}
      title={screen ? undefined : titleOf({ kayan, copy })}
      about={about}
      banner={controlled ? undefined : banner}
      views={controlled ? views : undefined}
      t={t}
      draft={status === 'changed' ? {
        busy: busy || autosaved === 'saving',
        onRestore: operations?.restoreVersion === true && client.run ? () => void run({ write: () => client.run!('restoreVersion', { id, ...readAt(props.expectedUpdatedAtOn?.includes('restoreVersion')) }), effect: 'update', operation: { name: 'restoreVersion' }, next: 'published' }) : undefined,
        onViewPublished: client.findByID ? () => void choose('published') : undefined,
        viewing,
      } : undefined}
    />
  )
  const unnamed = tree ? [] : kayan.fields.filter((field) => field.kind !== 'join')
  return (
    // The provider is around the whole screen, not just the column of inputs, so a panel the project
    // registered binds a field of this form through `useKayanField` wherever the layout put it.
    <KayanForm.Provider value={{ check, forget, form, issues: sentences, locales: localesOf(held), on, writes }}>
      <FormContext value={{ getData: () => showing, setValue, disabled: busy || viewing, saves: saving.saves, expectedUpdatedAtOn: props.expectedUpdatedAtOn }}>
        {/* One question for both ways out, Cancel and a blocked navigation, kept mounted so nothing but an answer closes it. */}
        <DiscardDialog
          t={t}
          busy={busy || autosaved === 'saving' || leaving}
          open={asking || !!blocked}
          note={saving.keepsDraft ? (t('admin.discardKeepsDraft', 'The draft saved so far is kept.') ?? 'The draft saved so far is kept.') : undefined}
          onOpenChange={(open) => {
            if (open || leaving) return
            setAsking(false)
            blocked?.reset()
          }}
          onDiscard={() => void saving.discard(blocked ? blocked.proceed : onCancel ?? (() => {}))}
        />
        {nodes || screen ? (
          <div className="flex flex-1 flex-col gap-6">{nodes ? drawNodes({ nodes: [{ form: [...nodes] }], draw }) : pageOf(screen!, draw)}</div>
        ) : (
          <FormLayout {...{ api, chrome, control, copy, formId, kayan, kayans, values }} row={value} actions={actionsOf(false)} onSubmit={submit} provided={unnamed.filter(owned)} rest={unnamed.filter((field) => !owned(field))} />
        )}
      </FormContext>
    </KayanForm.Provider>
  )
}
