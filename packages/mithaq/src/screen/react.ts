// Apart from `mithaq/admin`, so that entry, the CLI and a host of another framework load no React.
import { createContext, use } from 'react'
import type { AccessReport, AnyRouter, ClientKayan, FetchClient, NavEntry, Row, ScreenClient, Translate } from './client.ts'

/** Copy in the viewer's locale, and the direction that locale is written in. */
export type LocaleState = { locale: string; dir: 'ltr' | 'rtl'; t: Translate }

/** What a screen's host provides around every page it draws, and what each hook below reads one part of. */
export type ScreenState = LocaleState & {
  screen: ScreenClient
  /** Who is signed in, and the screens of another app the host links for this actor, each a whole URL. */
  user: {
    /** The signed-in person's own id, which a page compares with an id a row names, such as the actor of an audit entry. */
    id?: string
    name: string
    email: string
    screens?: readonly { name: string; path: string }[]
    /** `names` is each locale's name, the JSON the project's auth setup writes; `name` is the default locale's. */
    organizations?: readonly { id: string; name: string; slug?: string; names?: string }[]
    activeOrganizationId?: string | null
  }
  access: AccessReport
  client: FetchClient
  kayan?: ClientKayan
  record?: Row | null
  /** The page's path joined to the screen's, set on a page of the screen's own. */
  path?: string
}

/** The form a component sits in. */
export type FormState = {
  /** The values the form holds now. */
  getData: () => Readonly<Row>
  /** Changes one field. A field set here is saved even where the page names no leaf for it. */
  setValue: (path: string, value: unknown) => void
  /** Whether the form is busy saving, when nothing may change. */
  disabled: boolean
  /** How many saves have landed since the form was seeded. A draft save never bumps the row's `updatedAt`, so watch this instead. */
  saves: number
  /** The operations beside `update` that take the `expectedUpdatedAt` step's key. */
  expectedUpdatedAtOn?: readonly string[]
}

/** What a list hands whatever draws it: one page of rows, and where a row and a new row go. */
export type ListState = {
  page: { docs: readonly Row[]; totalDocs: number; page: number; totalPages: number }
  /** Whether this actor may create a row, off the report. */
  creates?: boolean
  href: (id: string) => string
  newHref: string
}

/** The one context a screen's host provides. */
export const ScreenContext = createContext<ScreenState | null>(null)
/** The form a component sits in, which each form item provides around the page it draws. */
export const FormContext = createContext<FormState | null>(null)
/** The list a component draws, which the host provides around a list node. */
export const ListContext = createContext<ListState | null>(null)

const screenState = (hook: string) => {
  const state = use(ScreenContext)
  if (!state) throw new Error(`${hook}() reads what a screen's host provides, and nothing above this component provides it: draw it inside a screen's page.`)
  return state
}

/** The screen as this actor may see it. */
export const useScreen = (): ScreenClient => screenState('useScreen').screen
/** The screen's nav, already cut to the entries this actor may open (`navOf`). */
export const useNav = (): NavEntry[] => screenState('useNav').screen.nav
/** Who is signed in. */
export const useUser = (): ScreenState['user'] => screenState('useUser').user
/** What the access report lets this actor do, cut to the screen's kayan. */
export const useAccess = (): AccessReport => screenState('useAccess').access
/** The viewer's locale, its direction and the copy in it. */
export const useLocale = (): LocaleState => {
  const { locale, dir, t } = screenState('useLocale')
  return { locale, dir, t }
}
/** The client posting this screen's operations: `useClient<typeof asas.router>()` types each call. */
export const useClient = <R = AnyRouter>(): FetchClient<R> => screenState('useClient').client as unknown as FetchClient<R>
/** The row the page draws, and `null` where it draws none. */
export const useRecord = (): Row | null => screenState('useRecord').record ?? null
/** The kayan the page belongs to. */
export const useKayan = (): ClientKayan => {
  const kayan = screenState('useKayan').kayan
  if (!kayan) throw new Error('useKayan() reads the kayan a page belongs to, and this page belongs to none: a page of the screen\'s own has no kayan.')
  return kayan
}
/** The form a component sits in; throws outside one. */
export const useForm = (): FormState => {
  const form = use(FormContext)
  if (!form) {
    throw new Error('useForm() reads the form a component sits in, and this component sits in none: only a component a form draws, such as one a form node names, can read or write its values.')
  }
  return form
}
/** One field of the form a component sits in, by its path: `path`, `value`, `setValue` and `disabled`. */
export const useField = <Value = unknown>({ path }: { path: string }) => {
  const form = useForm()
  return { path, value: form.getData()[path] as Value, setValue: (value: unknown) => form.setValue(path, value), disabled: form.disabled }
}
/** The list a component draws in place of the registry's list. */
export const useList = (): ListState => {
  const list = use(ListContext)
  if (!list) throw new Error('useList() reads the list a component draws, and this component draws none: only a component a list node names can read its rows.')
  return list
}
