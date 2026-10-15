import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { notFound, redirect, useMatches, useRouter } from '@tanstack/react-router'
import { createIsomorphicFn, createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { holds, navOf, referencesIn, type AccessReport, type ClientKayan, type LoaderTools, type Row, type ScreenClient } from 'mithaq/admin'
import { ScreenContext, useScreen, type ScreenState } from 'mithaq/admin/react'
import { actingAs, arm, authArm, caused, clientOf, readsOf, takesKey } from './api.ts'
import { clampedHref, routedHref } from './links.ts'
import { mergedHeaders } from './request-headers.ts'
import { documentHead, localeOf, locales, translator, type Locale } from './copy.ts'
import { FieldValue } from 'mithaq-admin/field-value.tsx'
import type { FormClient, FormProps } from 'mithaq-admin/form-types.tsx'
import type { Page } from 'mithaq-admin/list-types.tsx'
import { QueryRefused, findOf, listRaw, prefixOf, readQuery, rulesOf, scopedTo, withList, type RawQuery } from 'mithaq-admin/list-query.ts'
import { newTitleOf, titleOf } from 'mithaq-admin/copy.ts'
import { createsIn } from 'mithaq-admin/field-values.ts'
import { NavLinks } from 'mithaq-admin/nav-links.tsx'
import { NodeButton, OwnButton, pageButtonOf } from 'mithaq-admin/node-buttons.tsx'
import { formIn, listIn, nodesOf, readsAsValues, relatedIn, scopeOf, type Draw } from 'mithaq-admin/node-tree.ts'
import { frameOf, pageOf } from 'mithaq-admin/nodes.tsx'
import { RecordFrame, holdFocus } from 'mithaq-admin/record-frame.tsx'
import { rowTitle } from 'mithaq-admin/row-title.tsx'
import { refOf, type Refs, type TreePage } from 'mithaq-admin/screen-refs.ts'
import { idsOf } from 'mithaq-admin/relationship-control.tsx'
import { ScreenForm } from './screen-form.tsx'
import { ScreenList, askedFor, readsDrafts, rowReadsDrafts, rowsKey } from './screen-list.tsx'
import { screenNamed } from './screen-names.ts'
import { slide } from './slide.ts'
import { Toaster } from 'mithaq-admin/toast.tsx'
import { useCopy } from './routes/__root.tsx'

/**
 * The built asas, on the server alone. The module cache serves one build for
 * every call, since `asas` stays out of the server bundle; a changed `asas` takes a restart.
 */
export const getAsas = createServerOnlyFn(async () => (await import('asas')).asas)

type InProcess = Record<string, { operations: Record<string, (input: object, options: object) => Promise<unknown>> }>

/**
 * Each kayan's operations in process. In the backoffice app a read of a kayan asks `tenant: 'all'`,
 * which the runner grants backoffice staff there alone, so staff read every organization's rows; a
 * global is one organization's row and asks for none, and a write never asks.
 */
const inProcess = async (asas: Awaited<ReturnType<typeof getAsas>>): Promise<InProcess> => {
  const kayan = asas.kayan as unknown as InProcess
  if (!(await import('asas')).onBackoffice()) return kayan
  const reads = new Set(asas.operations.filter((one) => one.effect === 'read' && !one.single).map((one) => `${one.kayan}/${one.name}`))
  return Object.fromEntries(Object.entries(kayan).map(([name, one]) => [name, {
    operations: Object.fromEntries(Object.entries(one.operations).map(([operation, run]) =>
      [operation, reads.has(`${name}/${operation}`) ? (input: object, options: object) => run(input, { ...options, tenant: 'all' }) : run])),
  }]))
}

/** One screen's generated glob: each file its references name, keyed by the path a reference prints, loaded only when called. */
export type Files = Readonly<Record<string, () => Promise<unknown>>>

type Drawn = ComponentType<Record<string, unknown>>
const loaded = new Map<string, Drawn>()
const drawn = new Map<string, Drawn>()

const load = async (files: Files, reference: string) => {
  const at = reference.indexOf('#')
  const exported = ((await files[reference.slice(0, at)]?.()) as Record<string, Drawn> | undefined)?.[reference.slice(at + 1)]
  if (exported) loaded.set(reference, exported)
  return exported
}

// One `lazy` per reference. A loaded file is handed over as a thenable that
// resolves at once, which React reads without suspending; an unloaded one
// (hydration before any loader ran) suspends.
const drawnOf = (files: Files, reference: string) => {
  let found = drawn.get(reference)
  if (!found) {
    found = lazy(() => {
      const ready = loaded.get(reference)
      return ready
        ? ({ then: (resolve: (module: { default: Drawn }) => void) => resolve({ default: ready }) } as unknown as Promise<{ default: Drawn }>)
        : load(files, reference).then((exported) => ({ default: exported ?? (() => null) }))
    })
    drawn.set(reference, found)
  }
  return found
}

const refsOf = (files: Files, screen: ScreenClient): Refs =>
  Object.fromEntries(
    referencesIn(screen)
      .filter((reference) => Object.hasOwn(files, reference.slice(0, reference.indexOf('#'))))
      .map((reference) => [reference, drawnOf(files, reference)]),
  ) as Refs

const preload = (files: Files, ...parts: unknown[]) => Promise.all(referencesIn(parts).map((reference) => loaded.get(reference) ?? load(files, reference)))

/** This build's screens by name: what a request's screen name is checked against before anything is read by it. */
const screensOf = (targets: unknown) =>
  Object.fromEntries(Object.entries(targets as Record<string, { capability?: string } | undefined>).filter(([, target]) => target?.capability === 'screen'))

const segments = (path: string) => path.split('/').filter(Boolean)

/**
 * The page a path asks for, a kayan's or the screen's own, longest first and a
 * static segment before a parameter, so `/courses/new` is the create page, not
 * an edit of a row called `new`.
 */
export const matchPage = (screen: ScreenClient, path: string) => {
  const asked = segments(path)
  const pages = [
    ...Object.entries(screen.pages).map(([name, page]) => ({ kayan: undefined, name, page, parts: segments(page.path) })),
    ...Object.values(screen.kayan).flatMap((kayan) => Object.entries(kayan.pages).map(([name, page]) => ({ kayan: kayan.name as string | undefined, name, page, parts: segments(page.path) }))),
  ]
    .sort((a, b) => b.parts.length - a.parts.length || a.parts.filter((one) => one.startsWith(':')).length - b.parts.filter((one) => one.startsWith(':')).length)
  for (const one of pages) {
    if (one.parts.length !== asked.length) continue
    const params: Record<string, string> = {}
    if (one.parts.every((part, at) => (part.startsWith(':') ? ((params[part.slice(1)] = asked[at]!), true) : part === asked[at]))) {
      return { kayan: one.kayan, page: one.name, params }
    }
  }
  return undefined
}

type Actor = {
  readonly id?: string
  readonly name?: string | null
  readonly email?: string | null
  readonly impersonatedBy?: unknown
  readonly activeOrganizationId?: string | null
  readonly organizations?: readonly { readonly id: string; readonly name: string; readonly slug?: string }[]
}

// `'unauthorized'` is answered before the projection is read, so a refused screen sends no kayan, field, row or page;
// what is returned is serialized into the document, so projection and report are cut to what the actor may read.
const resolveScreen = async (asked: unknown) => {
  const [{ getRequest, setResponseHeader }, asas] = await Promise.all([import('@tanstack/react-start/server'), getAsas()])
  const name = screenNamed(screensOf(asas.targets), asked)
  const request = getRequest()
  const ask = (path: string) => asas.handler(new Request(new URL(path, request.url), { headers: request.headers }))
  await slide({ strategies: asas.auth.strategies, headers: request.headers, setResponseHeader })
  // Off the strategy loop, not the provider's session route: in process, so
  // no request counts against its rate limit.
  const actor = (await asas.auth.actor(request.headers)) as Actor | null
  if (!actor?.email) return undefined
  const report = (await (await ask('/api/access')).json()) as AccessReport
  if (!report.screens?.includes(name)) return 'unauthorized' as const
  const full = (asas.targets as unknown as Record<string, { client?: ScreenClient } | undefined>)[name]!.client!
  const kayan = Object.fromEntries(
    Object.entries(full.kayan)
      .filter(([one]) => report.collections?.[one]?.read === true)
      .map(([one, value]) => [one, { ...value, fields: value.fields.filter((field) => report.collections?.[one]?.fields?.[field.name]?.read === true) }]),
  )
  const { onBackoffice, backofficeEntry, BACKOFFICE_SCREEN } = await import('asas')
  const backoffice = backofficeEntry(actor)
  // The other screens of this app the actor may enter. The backoffice's own name
  // is left out of a tenant app's list, so the one link to it is `backofficeEntry`'s alone.
  const served = screensOf(asas.targets) as Record<string, { client: ScreenClient }>
  const siblings = (report.screens ?? [])
    .filter((one) => one !== name && Object.hasOwn(served, one) && (one === BACKOFFICE_SCREEN) === onBackoffice())
    .map((one) => ({ name: one, path: served[one]!.client.path }))
  const others = [...siblings, ...(backoffice ? [{ name: BACKOFFICE_SCREEN, path: backoffice }] : [])]
  return {
    asas,
    request,
    name,
    report,
    // Whole, so a page of a kayan the cut leaves out is told from a path naming no page.
    full,
    user: {
      ...(actor.id ? { id: actor.id } : {}),
      name: actor.name ?? actor.email,
      email: actor.email,
      // Only the fact; the id of the person behind the session stays on the server.
      ...(actor.impersonatedBy ? { impersonating: true } : {}),
      ...(others.length ? { screens: others } : {}),
      ...(actor.organizations && {
        organizations: actor.organizations.map(({ id, name, slug }) => ({ id, name, slug })),
        activeOrganizationId: actor.activeOrganizationId ?? null,
      }),
    },
    access: {
      // So `holds` answers a `screen.<name>` key in the browser as on the server.
      ...(report.screens === undefined ? {} : { screens: report.screens }),
      collections: Object.fromEntries(Object.keys(kayan).map((one) => [one, report.collections![one]])),
      // For a key neither a screen's nor an operation's, such as `user.ban`.
      ...(report.permissions === undefined ? {} : { permissions: report.permissions }),
    } satisfies AccessReport,
    // The nav is cut from the whole report, before the report is cut to the screen's kayan.
    screen: { ...full, kayan, nav: navOf(full, report) } as ScreenClient,
  }
}

/** The layout route's answer: who, what they may do, and the screen. */
export const loadScreen = createServerFn({ method: 'GET', strict: { output: false } })
  // Checked against this build's screens in `resolveScreen`.
  .validator((screen: unknown) => screen)
  .handler(async ({ data }) => {
    const found = await resolveScreen(data)
    return found === 'unauthorized' ? found : found ? { name: found.name, user: found.user, access: found.access, screen: found.screen } : null
  })

/**
 * What `/unauthorized` offers a signed-in actor: every screen the report lists for it, `null` without a session.
 * `from` is only matched against this build's screens and pages, so nothing a caller writes is said back.
 */
export const loadEnterable = createServerFn({ method: 'GET' })
  .validator((asked?: { from?: unknown; locale?: unknown }) => ({
    from: typeof asked?.from === 'string' ? asked.from : undefined,
    locale: localeOf(typeof asked?.locale === 'string' ? asked.locale : undefined),
  }))
  .handler(async ({ data }): Promise<{
    screens: { name: string; path: string }[]
    refused?: { page: string; screen: { name: string; path: string } }
    email?: string
    organizations?: { id: string; name: string; slug?: string }[]
    others?: { id: string; name: string; slug?: string }[]
    impersonating?: string
  } | null> => {
    const [{ getRequest }, asas, { onBackoffice, BACKOFFICE_SCREEN }] = await Promise.all([import('@tanstack/react-start/server'), getAsas(), import('asas')])
    const request = getRequest()
    const actor = (await asas.auth.actor(request.headers)) as Actor | null
    if (!actor?.email) return null
    const report = (await (await asas.handler(new Request(new URL('/api/access', request.url), { headers: request.headers }))).json()) as AccessReport
    const screens = screensOf(asas.targets) as Record<string, { client: ScreenClient }>
    const entered = (report.screens ?? [])
      .filter((name) => Object.hasOwn(screens, name) && (name === BACKOFFICE_SCREEN) === onBackoffice())
      .map((name) => ({ name, path: screens[name]!.client.path }))
    const impersonating = actor.impersonatedBy ? { impersonating: actor.name ?? actor.email } : {}
    if (entered.length) {
      const { from, locale } = data
      const home = from === undefined ? undefined : entered.find((one) => from === one.path || from.startsWith(`${one.path}/`))
      const match = home && matchPage(screens[home.name]!.client, from!.slice(home.path.length))
      if (!home || !match) return { screens: entered, ...impersonating }
      const page = nameOfPage({ screen: screens[home.name]!.client, name: home.name, match, copy: { t: translator(locale), locale } })
      return { screens: entered, refused: { page, screen: home }, ...impersonating }
    }
    const memberships = actor.organizations ?? []
    const active = memberships.find((one) => one.id === actor.activeOrganizationId)
    return {
      screens: entered,
      email: actor.email,
      organizations: (active ? [active] : memberships).map(({ id, name, slug }) => ({ id, name, slug })),
      others: onBackoffice() ? [] : memberships.filter((one) => one !== active).map(({ id, name, slug }) => ({ id, name, slug })),
      ...impersonating,
    }
  })

export { askedFor }

const holdsForm = (page: TreePage) => formIn(nodesOf(page)) !== undefined

const relatedOf = (screen: ScreenClient, kayan: ClientKayan) => Object.values(screen.kayan).filter((one) => kayan.fields.some((field) => field.relationTo === one.name))

const scopeTo = (node: { where?: string }, id: unknown) => ({ [node.where!]: { equals: id } })

/** One page's answer: which page the path asked for, the row a form draws, the rows a list draws, and what this actor may write. */
export const loadPage = createServerFn({ method: 'GET', strict: { output: false } })
  .validator((asked: { screen: unknown; path: string; query: Record<string, unknown> }) => ({
    screen: asked.screen,
    path: String(asked.path),
    query: askedFor(asked.query),
  }))
  .handler(async ({ data }) => {
    const found = await resolveScreen(data.screen)
    if (!found) return 'signed out' as const
    if (found === 'unauthorized') return found
    const { asas, screen } = found
    const match = matchPage(screen, data.path)
    // A page of a kayan the actor may not read is refused like a page whose key
    // it does not hold, so one role meets one denial page.
    if (!match) return matchPage(found.full, data.path) ? ('unauthorized' as const) : null
    // A page of the screen's own reads nothing, but one naming a key is served
    // only to an actor the report says holds it; its nav entry is only chrome.
    if (match.kayan === undefined) {
      const permission = screen.pages[match.page]?.permission
      if (permission !== undefined && !holds(found.report, permission)) return 'unauthorized' as const
      return { name: found.name, user: found.user, access: found.access, screen, kayan: undefined, page: match.page, value: null, first: undefined, related: {}, refused: [], creates: false, operations: {}, writable: {}, drafts: undefined }
    }
    const kayan = screen.kayan[match.kayan]
    if (!kayan) return null
    const page = kayan.pages[match.page]!
    const tree = 'page' in page ? page : undefined
    const actor = (await asas.auth.actor(found.request.headers)) ?? undefined
    const operations = (await inProcess(asas)) as unknown as Record<string, { operations: Record<string, (input: object, options: { actor?: unknown; draft?: boolean }) => Promise<unknown>> } | undefined>
    const globals = asas.global as unknown as typeof operations
    const readRow = async (id: string, draft: boolean) =>
      (await operations[kayan.name]!.operations.findByID!({ id }, { actor, ...(draft && { draft }) }).catch((thrown: unknown) => {
        if (!caused(thrown)) throw thrown
        return null
      })) as Row | null
    const report = found.access.collections?.[kayan.name]
    // A create page with no field to write is refused like a page whose key is
    // not held, not drawn as an empty form.
    if (match.page === 'create' && !createsIn({ kayan, report })) return 'unauthorized' as const
    // A kayan that keeps drafts, for an actor holding `findVersions` (the key a
    // draft read and a draft save ask): the actor edits the latest draft.
    // Without it, or where it leaves this row out, the actor reads the row and saves there.
    const drafting = await rowReadsDrafts({
      kayan,
      operations: report?.operations,
      id: kayan.single ? undefined : match.params.id,
      findVersions: (input) => operations[kayan.name]!.operations.findVersions!(input, { actor }).catch((thrown: unknown) => {
        if (!caused(thrown)) throw thrown
        return null
      }) as Promise<{ docs: readonly unknown[] } | null>,
    })
    let value: Row | null = null
    if (kayan.single ? !tree || holdsForm(tree) : match.params.id !== undefined) {
      if (kayan.single) value = (await globals[kayan.name]!.operations.findOne!({}, { actor })) as Row | null
      else if (match.params.id) {
        value = await readRow(match.params.id, drafting)
        if (!value) return null
      }
    }
    // A create page reads Draft from the start, since no published copy exists.
    // A plain read finds only a published row, which tells draft from changed.
    let drafts: FormProps['drafts']
    if (drafting && tree && holdsForm(tree)) {
      const published = value ? await readRow(String(value.id), false) : null
      drafts = {
        status: !published ? 'draft' : value!._status === 'draft' ? 'changed' : 'published',
        ...(kayan.drafts!.autosave && { autosave: kayan.drafts!.autosave.interval }),
      }
    }
    // The list this page draws, or the one it opens over. A URL the list does not
    // offer is refused before `find` is asked anything, and the page draws the refusal.
    const list = kayan.pages.list && 'page' in kayan.pages.list ? kayan.pages.list : undefined
    const listPage = tree && listIn(nodesOf(tree)) ? tree : tree?.mode ? list : undefined
    let first: { input: Record<string, unknown>; rows: Page } | undefined
    const node = listPage && listIn(nodesOf(listPage))
    if (node) {
      try {
        const input = findOf({
          kayan,
          query: readQuery(data.query, rulesOf({ kayan, node, maxLimit: screen.maxLimit, context: { client: relatedOf(screen, kayan), locales } })),
          node,
          locales,
          client: relatedOf(screen, kayan),
        })
        first = { input, rows: (await operations[kayan.name]!.operations.find!(input, { actor, ...(drafting && { draft: true }) })) as Page }
      } catch (thrown) {
        if (!(thrown instanceof QueryRefused)) throw thrown
      }
    }
    // Each list of another kayan the page draws over its row. A kayan the screen
    // does not cross (one the actor may not read) is read nothing, and so is a URL the list does not offer.
    const related: Record<string, { input: Record<string, unknown>; rows: Page }> = {}
    // Lists whose read the server refused, which the page says it cannot show rather than drawing nothing.
    const refused: string[] = []
    for (const one of tree && value ? relatedIn(nodesOf(tree), scopeOf({ values: {}, record: value, access: found.access, kayan })) : []) {
      const target = screen.kayan[one.of!]
      if (!target) continue
      try {
        const input = scopedTo(findOf({
          kayan: target,
          query: readQuery(listRaw(data.query, prefixOf(one)), rulesOf({ kayan: target, node: one, maxLimit: screen.maxLimit, context: { client: relatedOf(screen, target), locales } })),
          node: one,
          locales,
          client: relatedOf(screen, target),
        }), scopeTo(one, value!.id))
        const draft = readsDrafts(target, found.access.collections?.[target.name]?.operations)
        related[prefixOf(one)] = { input, rows: (await operations[target.name]!.operations.find!(input, { actor, ...(draft && { draft }) })) as Page }
      } catch (thrown) {
        if (!(thrown instanceof QueryRefused) && !caused(thrown)) throw thrown
        if ((thrown as { status?: unknown }).status === 403) refused.push(prefixOf(one))
      }
    }
    const own = (name: string) => (asas.operations as readonly { kayan: string; name: string; input: Parameters<typeof takesKey>[0] }[]).find((one) => one.kayan === kayan.name && one.name === name)
    const update = own('update')
    // The row a relationship title points at, read as this actor; one the actor
    // may not read names nothing. Only its id and title field go into the page's
    // data, which is serialized into the document.
    const titleField = kayan.fields.find((one) => one.name === kayan.useAsTitle && one.kind === 'relationship')
    const titledKayan = titleField ? screen.kayan[titleField.relationTo ?? ''] : undefined
    const titledId = value && titledKayan ? idsOf(value[titleField!.name])[0] : undefined
    const titledRow = titledId === undefined ? undefined : ((await operations[titledKayan!.name]?.operations.findByID?.({ id: titledId }, { actor }).catch((thrown: unknown) => {
      if (!caused(thrown)) throw thrown
      return null
    })) as Row | null | undefined)
    const titledField = titledKayan?.useAsTitle
    const titledBy = titledRow && titledField ? ({ id: titledRow.id, [titledField]: titledRow[titledField] } as Row) : undefined
    return {
      name: found.name,
      user: found.user,
      access: found.access,
      screen,
      kayan: kayan.name,
      page: match.page,
      value,
      first,
      related,
      refused,
      creates: createsIn({ kayan, report }),
      operations: report?.operations ?? {},
      writable: report?.fields ?? {},
      drafts,
      ...(titledBy && { titledBy }),
      // Whether the kayan's update takes the `expectedUpdatedAt` step's key, which the form then sends.
      ...(update && takesKey(update.input, 'expectedUpdatedAt') && { expectedUpdatedAt: true }),
      // And which of delete and restore do, for the Discards and the Versions tab's restore.
      expectedUpdatedAtOn: ['delete', 'restoreVersion'].filter((name) => { const one = own(name); return !!one && takesKey(one.input, 'expectedUpdatedAt') }),
    }
  })

type ScreenData = Exclude<Awaited<ReturnType<typeof loadScreen>>, 'unauthorized' | null>
type PageData = Exclude<Awaited<ReturnType<typeof loadPage>>, 'signed out' | 'unauthorized' | null>

const pathOf = (href: string) => href.split(/[?#]/)[0]!

/**
 * A screen's frame route's loader: resolves the session, access report and screen, and preloads the providers' files.
 * It is not `beforeLoad` because route context must be serializable and the projection's `rules` are `unknown`.
 */
export const frameLoader = async ({ screen, files, href }: { screen: string; files: Files; href: string }) => {
  const found = await loadScreen({ data: screen })
  if (!found) throw redirect({ to: '/auth/sign-in', search: { redirect: href } })
  if (found === 'unauthorized') throw redirect({ to: '/unauthorized', search: { from: pathOf(href) } })
  await preload(files, found.screen.providers)
  return found
}

// Server: in process as this request's actor, so the first HTML has what a loader reads. Browser: the page's `fetch`.
// Only the browser's client is held to the served read's cap; in process a `limit` of 0 is allowed.
const toolsOf = createIsomorphicFn()
  .server(async ({ access, maxLimit }: Pick<LoaderTools, 'access' | 'maxLimit'>): Promise<LoaderTools> => {
    const [{ getRequest }, asas] = await Promise.all([import('@tanstack/react-start/server'), getAsas()])
    const request = getRequest()
    const actor = (await asas.auth.actor(request.headers)) ?? undefined
    const kayan = (await inProcess(asas)) as unknown as Parameters<typeof actingAs>[0]
    return {
      client: actingAs(kayan, actor),
      request: (path, init) => asas.handler(new Request(new URL(path, request.url), { ...init, headers: mergedHeaders(request.headers, init?.headers) })),
      access,
      maxLimit,
    }
  })
  .client(async ({ access, maxLimit }: Pick<LoaderTools, 'access' | 'maxLimit'>): Promise<LoaderTools> => ({ client: clientOf(arm), request: fetch, access, maxLimit }))

/**
 * A screen page route's loader: the page `path` names and only the files it draws. A page naming a `permission`
 * is served only to an actor holding it; a page whose file exports a `loader` gets its return as `loaderData`.
 */
export const pageLoader = async ({
  screen,
  files,
  path,
  query,
  href,
}: {
  screen: string
  files: Files
  path: string
  query: Record<string, unknown>
  href: string
}) => {
  const found = await loadPage({ data: { screen, path, query } })
  if (found === 'signed out') throw redirect({ to: '/auth/sign-in', search: { redirect: href } })
  if (found === 'unauthorized') throw redirect({ to: '/unauthorized', search: { from: pathOf(href) } })
  if (!found) throw notFound()
  // A list asked for a page past its last is sent to its last, replacing the
  // entry the URL made, so back does not land on it again.
  const clamped = found.first && clampedHref({ href, page: found.first.rows.page, totalPages: found.first.rows.totalPages })
  if (clamped) throw redirect({ href: clamped, replace: true })
  await preload(files, ...partsOf(found))
  if (found.kayan === undefined) {
    const component = found.screen.pages[found.page]?.component
    const module = component ? ((await files[component.slice(0, component.indexOf('#'))]?.()) as { loader?: unknown } | undefined) : undefined
    if (typeof module?.loader === 'function') {
      return { ...found, loaderData: (await (module.loader as (tools: LoaderTools) => Promise<unknown>)(await toolsOf({ access: found.access, maxLimit: found.screen.maxLimit }))) as unknown }
    }
  }
  return found
}

const nameOfPage = ({ screen, name, match, row, titledBy, copy }: {
  screen: ScreenClient
  name: string
  match: { kayan?: string; page: string }
  row?: Row | null
  titledBy?: Row | null
  copy: { t: (key: string, fallback?: string) => string | undefined; locale: Locale }
}): string => {
  if (match.kayan === undefined) return screen.nav.find((entry) => !entry.kayan && entry.page === match.page)?.label?.[copy.locale] ?? copy.t(`screens.${name}`, name) ?? name
  const kayan = screen.kayan[match.kayan]!
  const page = kayan.pages[match.page]
  const many = !!page && 'page' in page && listIn(nodesOf(page)) !== undefined
  if (match.page === 'create') return newTitleOf({ kayan, copy })
  const field = kayan.fields.find((one) => one.name === kayan.useAsTitle)
  const target = field?.kind === 'relationship' ? screen.kayan[field.relationTo ?? ''] : undefined
  const titled = many ? undefined : target ? titledBy && rowTitle({ kayan: target, row: titledBy, locale: copy.locale }) : row && rowTitle({ kayan, row, locale: copy.locale })
  return titled || titleOf({ kayan, copy, many })
}

/** A page's route `head`: the tab names the page, then the app. A route that drew its not-found has no data and says the page was not found. */
export const pageHead = (data: PageData | undefined, context: { locale: Locale; app: string }) =>
  documentHead(context, (t) =>
    data ? nameOfPage({ screen: data.screen, name: data.name, match: data, row: data.value, titledBy: 'titledBy' in data ? data.titledBy : undefined, copy: { t, locale: context.locale } }) : t('admin.notFoundTitle', 'Page not found'))

const partsOf = (found: PageData): unknown[] => {
  if (found.kayan === undefined) return [found.screen.pages[found.page]]
  const kayan = found.screen.kayan[found.kayan]!
  const page = kayan.pages[found.page]!
  return [page, 'page' in page && page.mode ? kayan.pages.list : undefined, Object.values(found.screen.kayan).map((one) => one.fields)]
}

const useScreenState = (data: ScreenData): ScreenState => {
  const { dir, locale, t } = useCopy()
  return { t, locale, dir, screen: data.screen, access: data.access, user: data.user, client: clientOf(arm) }
}

/**
 * The bar that says the session is an impersonation, with the way out. Stopping
 * is a sign-out: the staff member's own session lives in the backoffice app under
 * that app's cookie, and the sign-out answers where they go next.
 */
export function ImpersonationBar({ name }: { name: string }): ReactElement {
  const { t } = useCopy()
  return (
    <div role="alert" data-impersonating="" className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-black">
      <span>
        {t('admin.impersonating', 'You are impersonating')} <strong>{name}</strong>.
      </span>
      <button
        type="button"
        className="rounded-md border border-black/40 px-3 py-1 font-semibold"
        // `replace`, so Back does not return to the page signed out of.
        onClick={() => void authArm('sign-out').then((answered) => window.location.replace(String(answered.body?.url ?? '/auth/sign-in')))}
      >
        {t('admin.stopImpersonating', 'Stop impersonating')}
      </button>
    </div>
  )
}

function ScreenBar({ user }: { user: ScreenData['user'] }): ReactElement | null {
  const { t } = useCopy()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const show = (event: Event) => setFailed((event as CustomEvent<boolean>).detail)
    window.addEventListener('mithaq:after-commit', show)
    return () => window.removeEventListener('mithaq:after-commit', show)
  }, [])
  return (
    <>
      {'impersonating' in user && user.impersonating ? <ImpersonationBar name={user.name} /> : null}
      {failed ? (
        <p role="status" className="rounded-md border border-amber-500/50 px-3 py-2 text-sm">
          {t('admin.afterCommitFailed', 'Saved, but a follow-up action failed, so something this save should have caused, such as an email or a notification, may be missing. Please contact an administrator.')}
        </p>
      ) : null}
    </>
  )
}

/** The screen's own frame: its providers, outermost first, around the frame's bar and the page. */
export function ScreenFrame({ files, data, children }: { files: Files; data: ScreenData; children: ReactNode }): ReactElement {
  const refs = refsOf(files, data.screen)
  // One per frame: made per request on the server, so no row one actor read
  // reaches another's render; held for the frame's life in the browser.
  const [queries] = useState(() => new QueryClient())
  // A hydrating page has had no loader run in the browser, so every file the
  // frame and page draw is asked for at once, off the answer the page's loader
  // sent, not one round trip per file as React reaches it.
  const page = useMatches({ select: (matches) => matches.at(-1)?.loaderData as PageData | undefined })
  useState(() => typeof window !== 'undefined' && void preload(files, data.screen.providers, ...(page?.screen ? partsOf(page) : [])))
  // A link inside the screen is followed by the router, so a tap reads the
  // next page's data instead of loading a whole document.
  const router = useRouter()
  const base = data.screen.path
  useEffect(() => {
    const follow = (event: MouseEvent) => {
      const href = routedHref({ event, origin: window.location.origin, base })
      if (href === undefined) return
      event.preventDefault()
      void router.navigate({ href })
    }
    document.addEventListener('click', follow)
    return () => document.removeEventListener('click', follow)
  }, [router, base])
  // Tab stays inside an open dialog, alert dialog or sheet, as in a native modal.
  useEffect(() => holdFocus(document.body), [])
  // A component that changed what the page reads, with no kayan operation to
  // say so, asks for a re-read of the lists and the page's loader without a
  // reload, so the scroll stays.
  useEffect(() => {
    const again = () => void Promise.all([queries.invalidateQueries(), router.invalidate()])
    window.addEventListener('mithaq:refresh', again)
    return () => window.removeEventListener('mithaq:refresh', again)
  }, [queries, router])
  // Suspends only while a hydrating page's files load.
  return (
    <QueryClientProvider client={queries}>
    <ScreenContext value={useScreenState(data)}>
    <Suspense fallback={null}>
      {data.screen.providers.reduceRight<ReactElement>(
        (inner, path) => {
          const Provider = refOf({ screen: { refs }, place: 'provider', path })!
          return <Provider>{inner}</Provider>
        },
        <>
          <ScreenBar user={data.user} />
          {children}
          {/* The one place every write's toast is drawn, kept across the screen's pages. */}
          <Toaster />
        </>,
      )}
    </Suspense>
    </ScreenContext>
    </QueryClientProvider>
  )
}

type PageViewProps = {
  files: Files
  data: PageData & { loaderData?: unknown }
  query: RawQuery
  onQuery: (search: Record<string, string>) => void
}

/** One page, inside what the host provides for it: the screen, and on a kayan's page that kayan and the row, which `useKayan()` and `useRecord()` read. */
export function ScreenPageView(props: PageViewProps): ReactElement {
  const { data } = props
  const state = useScreenState(data)
  // So a shell marks its home link on the home page alone.
  const own = data.screen.pages[data.page]?.path ?? '/'
  return (
    <ScreenContext value={data.kayan === undefined ? { ...state, path: own === '/' ? data.screen.path : `${data.screen.path}${own}` } : { ...state, kayan: data.screen.kayan[data.kayan], record: data.value }}>
      <PageBody {...props} />
    </ScreenContext>
  )
}

/**
 * A screen page route's not-found, drawn under the screen's frame in the shell
 * its pages use, so the nav stays and the way back is the screen's home. The
 * shell is the first page tree's, which is every page's in this template.
 */
export function ScreenNotFound({ files, screen: name }: { files: Files; screen: string }): ReactElement {
  const { t } = useCopy()
  const screen = useScreen()
  const refs = refsOf(files, screen)
  // A page that opens over its list is drawn inside the list's shell, so it names none to draw here.
  const framed = Object.values(screen.kayan).flatMap((kayan) => Object.values(kayan.pages).flatMap((page) => ('page' in page && !page.mode ? [{ kayan, page }] : [])))[0]
  const back = (t('auth.backTo', 'Back to {screen}') ?? 'Back to {screen}').replace('{screen}', () => t(`screens.${name}`, name) ?? name)
  const regions = {
    header: <h1 className="text-2xl font-bold tracking-tight">{t('admin.notFoundTitle', 'Page not found')}</h1>,
    nav: <nav aria-label={t('admin.navigation', 'Navigation')}><NavLinks /></nav>,
    main: (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground text-sm">{t('admin.notFound', 'That page does not exist.')}</p>
        <a className="text-foreground text-sm underline underline-offset-4" href={screen.path}>{back}</a>
      </div>
    ),
  }
  if (!framed) return <main className="p-6">{regions.header}{regions.main}</main>
  return <>{frameOf({ screen: { refs, ...framed }, t, path: framed.page.page.shell, regions })}</>
}

function PageBody({ files, data, query, onQuery }: PageViewProps): ReactElement | null {
  const refs = refsOf(files, data.screen)
  const router = useRouter()
  const queries = useQueryClient()
  const { locale, t } = useCopy()
  if (data.kayan === undefined) {
    const Page = refOf({ screen: { refs }, place: 'page', path: data.screen.pages[data.page]?.component })
    return Page ? <Page loaderData={data.loaderData} /> : null
  }
  const kayan = data.screen.kayan[data.kayan]!
  const declared = kayan.pages[data.page]!
  if ('component' in declared) {
    const Whole = refOf({ screen: { refs }, place: 'component', path: declared.component })
    return Whole ? <Whole page={declared} /> : null
  }
  const page = declared
  const base = data.screen.path
  const hrefOf = (target: ClientKayan, pageName: string | undefined, id?: string) => {
    const path = pageName === undefined ? undefined : target.pages[pageName]?.path
    return path ? `${base}${id ? path.replace(':id', encodeURIComponent(id)) : path}` : undefined
  }
  // A row opens its kayan's edit page, else the one page whose path draws a
  // row (how the backoffice opens a record it only reads).
  const rowPage = (target: ClientKayan) => (target.pages.edit ? 'edit' : Object.keys(target.pages).find((one) => target.pages[one]!.path.includes(':id')))
  const related = relatedOf(data.screen, kayan)
  const go = (href: string | undefined) => void (href ? router.navigate({ href }) : router.invalidate())
  const written = <Written,>(write: Promise<Written>, name = kayan.name) =>
    write.then((out) => {
      void queries.invalidateQueries({ queryKey: rowsKey(name) })
      return out
    })

  // A list of another kayan on this page: the rows whose `where` holds the row
  // the page draws. The screen crosses only the kayan the actor may read, so one
  // it may not is refused here, as is one whose read the server refused.
  const relatedList = (target: TreePage, node: Parameters<NonNullable<Draw['list']>>[0]['node'], index: number, own?: ReactElement) => {
    const listed = data.screen.kayan[node.of!]
    // Both look the same to the viewer: rows it cannot see.
    if (!listed || data.refused.includes(prefixOf(node))) {
      return (
        <p key={index} role="alert" data-mithaq-refused-list={node.of} className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
          {t('admin.cannotSee', 'You can\'t see this')}
        </p>
      )
    }
    const id = data.value?.id
    if (id === undefined) return null
    const prefix = prefixOf(node)
    const report = data.access.collections?.[listed.name]
    const targets = relatedOf(data.screen, listed)
    return (
      <ScreenList
        key={index}
        props={{
          kayan: listed,
          node,
          client: targets,
          api: readsOf([listed, ...targets]),
          creates: createsIn({ kayan: listed, report }),
          operations: report?.operations ?? {},
          writes: (field) => report?.fields?.[field]?.update === true,
          access: data.access,
          t,
          locale,
          locales,
          href: (row) => hrefOf(listed, rowPage(listed), row) ?? '#',
          newHref: '#',
          screen: { refs, kayan: listed, page: target },
          edit: {
            client: {
              create: (input) => written(arm[listed.name]!.create!(input), listed.name),
              update: (input) => written(arm[listed.name]!.update!(input), listed.name),
              delete: (input) => written(arm[listed.name]!.delete!(input), listed.name),
            },
            writes: (field, on) => report?.fields?.[field]?.[on] === true,
            prefill: { [node.where!]: id },
          },
        }}
        raw={listRaw(query, prefix)}
        onQuery={(search) => onQuery(withList({ raw: query, prefix, written: search }))}
        first={data.related[prefix]}
        scope={scopeTo(node, id)}
        find={(input, options) => arm[listed.name]!.find!(input, options) as Promise<Page>}
        run={(operation, input) => arm[listed.name]![operation]!(input)}
        own={own}
      />
    )
  }

  const draw = (target: TreePage): Draw => {
    return {
      kayan,
      copy: { t, locale },
      issues: {},
      // A page drawn here holds no form, so a `when` reads the row and the report alone.
      scope: scopeOf({ values: {}, record: data.value, access: data.access, kayan }),
      // A leaf is the row's value drawn by its cell, read and never edited.
      control: (leaf) => {
        const field = kayan.fields.find((one) => one.name === (typeof leaf === 'string' ? leaf : leaf.field))
        return field ? (
          <FieldValue
            key={field.name}
            kayan={kayan}
            field={field}
            leaf={typeof leaf === 'string' ? undefined : leaf}
            row={data.value}
            copy={{ t, locale }}
            api={readsOf(related)}
            kayans={related}
            screen={{ refs, kayan, page: target }}
          />
        ) : null
      },
      component: (path, index) => {
        const Component = refOf({ screen: { refs }, place: 'component', path })
        return Component ? <Component key={index} page={target} /> : null
      },
      layout: ({ path, regions, index }) => frameOf({ screen: { refs, kayan, page: target }, t, path, regions, key: index }),
      // A list node naming a component is drawn by it, which reads through
      // `useList()` what the registry's list is handed.
      list: ({ node, index, component }) => {
        const Own = component ? refOf({ screen: { refs }, place: 'component', path: component }) : undefined
        if (node.of) return relatedList(target, node, index, Own ? <Own page={target} /> : undefined)
        return (
          <ScreenList
            key={index}
            props={{
              kayan,
              client: related,
              api: readsOf([kayan, ...related]),
              creates: data.creates && !!kayan.pages.create,
              operations: data.operations,
              writes: (field) => data.writable[field]?.update === true,
              access: data.access,
              t,
              locale,
              locales,
              href: (id) => hrefOf(kayan, rowPage(kayan), id) ?? '#',
              newHref: hrefOf(kayan, 'create') ?? '#',
              screen: { refs, kayan, page: target },
            }}
            raw={query}
            onQuery={onQuery}
            first={data.first}
            find={(input, options) => arm[kayan.name]!.find!(input, options) as Promise<Page>}
            run={(operation, input) => arm[kayan.name]![operation]!(input)}
            own={Own ? <Own page={target} /> : undefined}
          />
        )
      },
      nav: () => <NavLinks />,
      button: (node, index) => {
        const button = pageButtonOf({ kayan, node, allowed: data.operations })
        if (!button) return null
        const call = async (input: Row) => {
          await written(arm[kayan.name]![button.name]!({ ...input, ...(data.value?.id !== undefined && { id: data.value.id }) }))
          await router.invalidate()
        }
        // A project's button component is handed a run that asks the confirm
        // first; the registry's own button asks it before calling.
        const Own = node.component ? refOf({ screen: { refs }, place: 'button', path: node.component }) : undefined
        return Own ? (
          <OwnButton key={index} Own={Own} operation={button} busy={false} copy={{ t, locale }} call={call} />
        ) : (
          <NodeButton key={index} node={node} copy={{ t, locale }} busy={false} run={() => void call({})} />
        )
      },
    }
  }
  const drawn = (target: TreePage) => pageOf({ refs, kayan, page: target }, draw(target))
  if (readsAsValues({ page, value: data.value, operations: data.operations })) return <>{drawn(page)}</>

  const listHref = hrefOf(kayan, 'list')
  const client: FormClient = kayan.single
    ? {
        create: ({ id: _id, ...input }) => arm[kayan.name]!.update!(input),
        update: ({ id: _id, ...input }) => arm[kayan.name]!.update!(input),
        delete: () => Promise.reject(new Error(`"${kayan.name}" is one row and declares no delete.`)),
      }
    : {
        create: (input, options) => written(arm[kayan.name]!.create!(input, options)),
        update: (input, options) => written(arm[kayan.name]!.update!(input, options)),
        delete: (input) => written(arm[kayan.name]!.delete!(input)),
        run: (operation, input) => written(arm[kayan.name]![operation]!(input)),
        findByID: (input) => arm[kayan.name]!.findByID!(input),
      }
  const form = (
    <ScreenForm
      kayan={kayan}
      screen={{ refs, kayan, page }}
      client={client}
      value={data.value}
      t={t}
      locale={locale}
      locales={locales}
      writes={(field, on) => data.writable[field]?.[on] === true}
      kayans={related}
      api={readsOf(related)}
      operations={data.operations}
      related={draw(page).list}
      // A create opened over its list closes back to it once it lands, the new row in the list, as Payload's drawer does.
      // ponytail: a kayan that autosaves drafts closes on its first autosave there; hold the drawer open on an autosave's create if one ever opens over its list.
      edit={(id) => (page.mode ? listHref : hrefOf(kayan, 'edit', id))}
      list={listHref}
      drafts={data.drafts}
      expectedUpdatedAt={data.expectedUpdatedAt}
      expectedUpdatedAtOn={data.expectedUpdatedAtOn}
    />
  )
  const list = kayan.pages.list
  if (page.mode && list && 'page' in list) {
    return (
      <>
        {drawn(list)}
        {/* Named for a screen reader by the page's title, a create as new. */}
        <RecordFrame mode={page.mode} title={(data.value ? titleOf : newTitleOf)({ kayan, copy: { t, locale } })} closeLabel={t('admin.close', 'Close') ?? 'Close'} onClose={() => go(listHref)}>
          {form}
        </RecordFrame>
      </>
    )
  }
  return form
}
// mithaq-admin 0.0.0 7684e1a5a3654f1305cb73392791318b0c9db0106c740c35bb34691fa2dfd703
