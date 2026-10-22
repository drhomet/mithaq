import type { ClientKayan } from 'mithaq/admin'
import type { FindApi } from 'mithaq-admin/control-props.ts'
import type { Translate } from 'mithaq-admin/copy.ts'
import type { Draw, Node } from 'mithaq-admin/node-tree.ts'
import type { ScreenPage } from 'mithaq-admin/screen-refs.ts'

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

/** Where a row of a kayan that keeps drafts stands: never published, published, or published with a newer draft pending. */
export type DraftStatus = 'draft' | 'published' | 'changed'

/** Where a draft save leaves a row: a published row now holds a newer draft, any other is still a draft. */
export const afterDraft = (status?: DraftStatus): DraftStatus => (status === 'published' || status === 'changed' ? 'changed' : 'draft')

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
  /** Keeps a drawer's general refusal beside its fields rather than only in a toast. */
  inlineRefusal?: boolean
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
