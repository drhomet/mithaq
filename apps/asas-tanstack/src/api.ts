import { afterCommitHeader, type ClientKayan, type FetchClient } from 'mithaq/admin'

/** What a write may ask beside its input on a kayan that keeps drafts: a draft save, and an autosave. The fetch plug reads them off the query string only. */
export type DraftOptions = { readonly draft?: boolean; readonly autosave?: boolean }

const queryOf = ({ draft, autosave }: DraftOptions = {}) => (draft ? `?draft=true${autosave ? '&autosave=true' : ''}` : '')

const call = async ({ kayan, operation, input, ...options }: { kayan: string; operation: string; input: Record<string, unknown> } & DraftOptions) => {
  const response = await fetch(`/api/${encodeURIComponent(kayan)}/${encodeURIComponent(operation)}${queryOf(options)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const answer = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(typeof answer?.message === 'string' ? answer.message : `HTTP ${response.status}`)
    Object.assign(error, { status: response.status, code: answer?.code, data: answer?.data })
    throw error
  }
  // A failed `afterCommit` raises the screens' banner and a committed write
  // clears it. Only the server knows an operation's effect, so the plug sets
  // the header on writes and never on reads.
  const said = response.headers.get(afterCommitHeader)
  if (typeof window !== 'undefined' && said) {
    window.dispatchEvent(new CustomEvent('mithaq:after-commit', { detail: said === 'failed' }))
  }
  return answer
}

// Restated, not imported from the `.tsx` file that declares them: a `.ts` file
// must not need the JSX compiler.
type FoundPage = { docs: readonly Record<string, unknown>[]; hasNextPage: boolean; nextPage: number | null }
type FindApi = Readonly<
  Record<
    string,
    | {
        find: (input: Record<string, unknown>) => Promise<FoundPage>
        create?: (input: Record<string, unknown>) => Promise<unknown>
        delete?: (input: Record<string, unknown>) => Promise<unknown>
        update?: (input: Record<string, unknown>) => Promise<unknown>
      }
    | undefined
  >
>

/**
 * Every operation of every kayan, keyed by name strings. `arm[kayan][operation](input)`
 * posts to `POST /api/<kayan>/<operation>`; the proxy never answers `undefined`,
 * and a name no kayan has is the server's not-found.
 */
export type Arm = Readonly<Record<string, Readonly<Record<string, (input: Record<string, unknown>, options?: DraftOptions) => Promise<unknown>>>>>
export const arm = new Proxy(Object.create(null) as Arm, {
  get: (_target, kayan: string) => new Proxy(Object.create(null) as Record<string, (input: Record<string, unknown>, options?: DraftOptions) => Promise<unknown>>, {
    get: (_operations, operation: string) => (input: Record<string, unknown>, options?: DraftOptions) => call({ kayan, operation, input, ...options }),
  }),
})

/**
 * Whether an operation's input names a key: probes the schema with a value no
 * browser-written schema accepts and looks for an issue at that key. A schema
 * that answers asynchronously, or throws, reads as naming nothing.
 */
export const takesKey = (input: { '~standard': { validate: (value: unknown) => unknown } }, key: string) => {
  let answer: { issues?: readonly { path?: readonly unknown[] }[] }
  try {
    answer = input['~standard'].validate({ [key]: Symbol(key) }) as typeof answer
  } catch {
    return false
  }
  if (answer instanceof Promise) {
    answer.catch(() => {})
    return false
  }
  return answer.issues?.some(({ path }) => {
    const segment = path?.[0]
    return String(typeof segment === 'object' && segment ? (segment as { key: unknown }).key : segment) === key
  }) ?? false
}

/** What a screen's `client` is over an arm; the draft words ride along with the input. */
export const clientOf = (through: Arm): FetchClient => ({ kayan, operation, input, draft, autosave }) => through[kayan]![operation]!(input, { draft, autosave })

/**
 * What the server's `client` is: each operation in process, as `actor`. Only the
 * two draft words are read off the caller's options and the actor goes last, so
 * a loader cannot run as someone else.
 */
export const actingAs = (
  through: Readonly<Record<string, { operations: Record<string, (input: object, options: { actor?: unknown } & DraftOptions) => Promise<unknown>> }>>,
  actor: unknown,
): FetchClient => ({ kayan, operation, input, draft, autosave }) => through[kayan]!.operations[operation]!(input, { draft, autosave, actor })

/**
 * What a relationship control and cell read a second kayan through. Only the
 * kayans the screen's loader already narrowed to what this actor may read are
 * in the record, so a picker cannot page any other.
 */
export const readsOf = (kayans: readonly ClientKayan[]): FindApi =>
  Object.fromEntries(
    kayans.map((kayan) => [
      kayan.name,
      {
        find: (input: Record<string, unknown>) => arm[kayan.name]!.find!(input) as Promise<FoundPage>,
      },
    ]),
  )

type FieldReads = {
  readonly collections?: Readonly<
    Record<string, { readonly fields?: Readonly<Record<string, Readonly<Record<string, boolean>> | undefined>> } | undefined>
  >
}

/**
 * One kayan of the projection with every field this actor may not read taken
 * off it. A loader's result is serialized into the document, so an unreadable
 * field's name, label or rule would otherwise reach the viewer.
 */
export const readable = (one: ClientKayan, report: FieldReads): ClientKayan => ({
  ...one,
  fields: one.fields.filter((field) => report.collections?.[one.name]?.fields?.[field.name]?.read === true),
})

/**
 * Whether a thrown refusal is the caller's. Those carry an HTTP status; a store
 * that is down or a hook bug carries none and must be rethrown, not reported
 * as a missing row.
 */
export const caused = (thrown: unknown): boolean =>
  typeof (thrown as { status?: unknown } | null | undefined)?.status === 'number'

/**
 * One POST at the auth arm (Better Auth's router under `/api/auth/user`) with the session cookie.
 * Returns the answer instead of throwing: a refusal is a sentence for the viewer; no reply is status 0.
 */
export const authArm = async (path: string, body: unknown = {}) => {
  const response = await fetch(`/api/auth/user/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  if (!response) return { ok: false, status: 0, message: undefined, body: null }
  const answered = (await response.json().catch(() => null)) as ({ message?: string } & Record<string, unknown>) | null
  // The status too, because a rate limit's refusal carries no code to read.
  return { ok: response.ok, status: response.status, message: answered?.message, body: answered }
}
// mithaq-admin 2d3ab739c92c6c2b397041b76bf4b23b2902b7a2 94db2fc49ad4391c0d1c2183cb41001dd08d62017c76af86cc5f611488c22c68
