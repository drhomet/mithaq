import type { AuditHandler, ContextOf, ProjectStep, Step } from '../asas/runner/steps.ts'
import type { Authorize } from '../asas/runner/write.ts'


/** The runner as a target, `capability: 'service'`: the steps every write runs, its limits, its access evaluator and its defaults. */
export type ServiceTarget = {
  readonly capability: 'service'
  readonly type?: 'service'
  /** Not a key of the runner: a kayan declares its own operations, spreading `defaultOperations`. */
  readonly operations?: never
  /** The steps every write runs inside its transaction, after the row is loaded and before the operation's own list. */
  readonly beforeSteps?: readonly ProjectStep[]
  /** The steps every write runs inside its transaction after the list, before the commit: `afterSteps: [audit]`. An operation may write its own. */
  readonly afterSteps?: readonly ProjectStep[]
  /** The steps every write runs after the commit, where the row is durable and visible to every connection. */
  readonly afterCommit?: readonly ProjectStep[]
  /** The keys this project adds to every step's `ctx.context`, as a type: `context: {} as { requestId: string }`. */
  readonly context?: Record<string, unknown>
  /** The sink explicit audit steps call before commit. */
  readonly audit?: AuditHandler<never>
  /** The deepest a read or a write may nest another before it is refused. */
  readonly depth: number
  /** The page a `find` or `findVersions` answers when its caller names no `limit`. */
  readonly defaultLimit: number
  /** The most rows a served `find` or `findVersions` may ask for; a larger `limit` is a 400. Local calls are not held to it. */
  readonly maxLimit: number
  /** How many of a child's rows one populated `join` carries where the join field names no `defaultLimit`. */
  readonly joinLimit: number
  /** The most rows one bulk write may match; a larger match is refused before any row is written. */
  readonly bulkLimit: number
  /** The access evaluator every operation uses before application steps. */
  readonly authorize: Authorize
  /**
   * The field that marks a row deleted, for the whole project. A kayan that declares it is
   * soft-deleted: `delete` writes the moment there and every managed read leaves the row out.
   */
  readonly softDelete?: string
  /** The default store, the database a write lands in when a kayan names none. */
  readonly store: string
  /** The default schema target, what a write is validated against when a kayan names none. */
  readonly schema: string
}

/** The template's depth cap: 8. A larger cap only delays the throw and holds the transaction open longer. */
export const defaultDepth = 8

/** The template's page size: 10. */
export const defaultLimit = 10

/** The template's largest served page: 100. A `limit` outside 1 to the maximum is refused, never clamped. */
export const defaultMaxLimit = 100

/** The template's join page: 10. */
export const defaultJoinLimit = 10

/** The template's bulk ceiling: 1000. */
export const defaultBulkLimit = 1000

// Not on `ServiceTarget`, because an object type cannot read a sibling key: only
// the factory sees the whole argument and can type the lists off `context`.
type ServiceLists<Extra extends Record<string, unknown>> = {
  readonly beforeSteps?: readonly Step<Record<string, unknown>, Record<string, unknown>, unknown, unknown, unknown, Extra>[]
  readonly afterSteps?: readonly Step<Record<string, unknown>, Record<string, unknown>, unknown, unknown, unknown, Extra>[]
  readonly afterCommit?: readonly Step<Record<string, unknown>, Record<string, unknown>, unknown, unknown, unknown, Extra>[]
}

/** Core's runner as the service target of a build. */
export const serviceTarget = <const Service extends Omit<ServiceTarget, 'capability' | 'type'>>(
  service: Service & NoInfer<ServiceLists<ContextOf<Service>>>,
): Service & { readonly capability: 'service'; readonly type: 'service' } => ({ capability: 'service', type: 'service', ...service })
