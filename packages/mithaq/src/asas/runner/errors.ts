// Both HTTP plugs read the code from here, so a refusal answers the same through either.
export const codes = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
} as const

/**
 * A refusal the caller caused, with the HTTP status, a message `key` a client
 * translates, and the `params` the message names. The English message is for logs.
 */
export class AsasError extends Error {
  readonly status: 400 | 403 | 404 | 409
  readonly key: MessageKey
  readonly params: Readonly<Record<string, unknown>>

  constructor(
    message: string,
    status: 400 | 403 | 404 | 409,
    key: MessageKey,
    params: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.status = status
    this.key = key
    this.params = params
  }
}

/** A write committed, but one or more callbacks that followed it failed. */
export class AfterCommitError extends Error {
  readonly committed = true
  readonly result: unknown

  constructor(result: unknown, cause: unknown) {
    super('The write committed, but an afterCommit step failed.', { cause })
    this.result = result
  }
}

/** Something a project is told that is expected rather than a failure, handed to the same `onError`. */
export class Notice extends Error {
  override name = 'Notice'
}

/** A generic wire signal; callback details remain in the server reporter. */
export const afterCommitHeader = 'x-mithaq-after-commit'

/** A refusal's key in the message namespace. */
export type MessageKey = `error.${'conflict' | 'forbidden' | 'invalid' | 'not_found'}.${string}`

/** What every refusal takes: the English a log reads, the key a client translates, the values it names, and the cause. */
export type Refusal = { message: string; key: MessageKey; params?: Record<string, unknown>; cause?: unknown }

/** The caller may not do this. */
export const denied = ({ message, key, params, cause }: Refusal) => new AsasError(message, 403, key, params, cause)

/** The caller sent something the schema or the shape refuses. */
export const invalid = ({ message, key, params, cause }: Refusal) => new AsasError(message, 400, key, params, cause)

/**
 * The row the caller addressed is not there. An absent row and one access
 * excludes answer alike, so a 404 never says which.
 */
export const missing = ({ message, key, params, cause }: Refusal) => new AsasError(message, 404, key, params, cause)

/**
 * The write collides with a row already there, as a 409 so an offline client
 * does not retry it. It never says which column or whose row it hit.
 */
export const conflict = ({ message, key, params, cause }: Refusal) => new AsasError(message, 409, key, params, cause)

// Shared by the read layer, which answers the caller with a 400, and the drizzle
// store, which throws at the access callback that built the query.
export const localizedQuery = ({
  kayan,
  field,
  what,
  locales = [],
}: {
  kayan: string
  field: string
  what: 'filter' | 'sort'
  locales?: readonly string[]
}) =>
  what === 'sort'
    ? `Kayan "${kayan}" field "${field}" is localized, so it is one column per locale and no sort can name it. A sort that names one locale is not built. Name a field that is not localized, or read the rows and pick the locale in the app.`
    : `Kayan "${kayan}" field "${field}" is localized, so it is one column per locale and no filter can name the field itself. Name the locale as a second path segment instead, ${locales.map((locale) => `"${field}.${locale}"`).join(' or ')}. That path is one hop only, so a localized field reached across a relationship cannot name its locale.`
