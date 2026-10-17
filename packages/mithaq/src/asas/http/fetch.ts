// Imports no library, so a project that wants plain HTTP installs no optional peer.
import type { HttpPlug, OperationTable } from '../build.ts'
import { AfterCommitError, AsasError, afterCommitHeader, codes, retryConflict } from '../runner/errors.ts'
import type { StandardSchemaV1 } from '../../mithaq/standard-schema.ts'

type WireShape = {
  type?: string
  shape?: Record<string, WireShape>
  element?: WireShape
  unwrap?: () => WireShape
}

// The walk enters objects, arrays and the wrappers `unwrap()` opens, and nothing else.
const datesFromJson = (value: unknown, schema: WireShape): unknown => {
  if (schema.type === 'date' && typeof value === 'string') {
    // Date.parse normalizes February 30, which the declared z.date must refuse.
    const day = value.slice(0, 10)
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
      && Number(value.slice(11, 13)) < 24) {
      const parsed = new Date(value)
      const midnight = new Date(`${day}T00:00:00Z`)
      if (!Number.isNaN(parsed.getTime()) && !Number.isNaN(midnight.getTime()) && midnight.toISOString().slice(0, 10) === day) return parsed
    }
  }
  if (['optional', 'nullable', 'default', 'prefault', 'nonoptional', 'readonly'].includes(schema.type ?? '')) {
    return schema.unwrap ? datesFromJson(value, schema.unwrap()) : value
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.element) {
    return value.map((one) => datesFromJson(one, schema.element!))
  }
  if (schema.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value) && schema.shape) {
    const result = { ...value } as Record<string, unknown>
    for (const [name, child] of Object.entries(schema.shape)) {
      if (Object.hasOwn(result, name)) result[name] = datesFromJson(result[name], child)
    }
    return result
  }
  return value
}

/** The Zod input decides which JSON strings represent dates on either HTTP plug. */
export const decodeJson = (value: unknown, schema: StandardSchemaV1): unknown =>
  schema['~standard'].vendor === 'zod' ? datesFromJson(value, schema as WireShape) : value

// `?draft=true` saves or reads a draft, and `?autosave=true` beside it lets the
// save overwrite an autosave. `?tenant=` is a read's reach, which the runner judges.
export const draftOptions = (request: Request) => {
  const query = new URL(request.url).searchParams
  return {
    ...(query.get('draft') === 'true' ? { draft: true } : {}),
    ...(query.get('autosave') === 'true' ? { autosave: true } : {}),
    ...(query.has('tenant') ? { tenant: query.get('tenant')! } : {}),
  }
}

/**
 * The largest request body a plug reads, which a project names as `maxBodyBytes`: room for a
 * json field's `defaultJsonMaxBytes` written in any script. A file never comes this way.
 */
export const defaultMaxBodyBytes = 4 * 1024 * 1024

/**
 * The body, or the answer that refuses it: 413 once it passes `limit` bytes, and 499 to a client
 * that went away mid-body, which is no fault of the server's. Counted as it arrives, since a
 * `content-length` may be absent or wrong, and the rest is never read.
 */
export const boundedBody = async (request: Request, limit: number): Promise<Blob | Response> => {
  const reader = request.body?.getReader()
  const refused = () => {
    // Not awaited: a clone's cancel settles only once its twin is cancelled too, which the
    // caller does after this returns.
    reader?.cancel().catch(() => {})
    return tooLarge(limit)
  }
  if (Number(request.headers.get('content-length')) > limit) return refused()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    let read: ReadableStreamReadResult<Uint8Array>
    try {
      read = (await reader?.read()) ?? { done: true, value: undefined }
    } catch (thrown) {
      if (request.signal.aborted) return new Response(null, { status: 499 })
      throw thrown
    }
    if (read.done) return new Blob(chunks as BlobPart[])
    size += read.value.byteLength
    if (size > limit) return refused()
    chunks.push(read.value)
  }
}

/** Refused by name, since core holds no limit of its own. */
export const assertMaxBodyBytes = (owner: string, value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${owner} names no "maxBodyBytes", the largest request body in bytes it reads, as a whole number above 0. Name the project's own, such as defaultMaxBodyBytes from mithaq.`)
  }
}

/** Refused by name, as `auth.onError` and `storage.onError` are: core reports no fault of its own. */
export const assertOnError = (owner: string, value: unknown) => {
  if (typeof value !== 'function') {
    throw new Error(`${owner} names no "onError" function, which it hands every error that is no refusal before it answers 500. Name the project's own, such as console.error.`)
  }
}

export const tooLarge = (limit: number) =>
  Response.json({ code: codes[413], message: `The request body holds at most ${limit} bytes.` }, { status: 413 })

export type FetchHttpOptions = {
  /** The largest body a call takes, answered 413 past it: `defaultMaxBodyBytes` or the project's own. Required. */
  maxBodyBytes: number
  /**
   * Builds the context every step of a served call reads, from the request and the actor.
   * The plug reads no header or body key into it; a throw is answered 500.
   */
  context?: (request: Request, actor: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>
  /** Handed every error that is not an `AsasError`, before the 500 goes out with its message replaced. Required. */
  onError: (error: unknown) => void
}

/**
 * The default HTTP plug: `POST /api/<kayan>/<operation>` with a JSON body, over
 * `Request` and `Response` alone. The runner parses each operation's input.
 */
export const fetchHttp = (options: FetchHttpOptions) => {
  // Read off `options?`, since a JavaScript caller may hand nothing, and is refused by name.
  assertMaxBodyBytes('fetchHttp', options?.maxBodyBytes)
  assertOnError('fetchHttp', options.onError)
  const { context, onError, maxBodyBytes } = options
  return <View>(operations: OperationTable<View>): HttpPlug => {
    const table = new Map(operations.map((one) => [`${one.kayan}/${one.name}`, one]))
    return {
      name: 'fetch',
      // The operation table is the routes, already published as `asas.operations`.
      router: undefined,
      handle: async (request, actor) => {
        if (request.method !== 'POST') return null
        // Two segments under `/api` and no more, so another plug's three-segment prefix
        // falls through. `null`, not a 404, so a host keeps its own routes.
        const [api, kayan, name, ...rest] = new URL(request.url).pathname.split('/').slice(1)
        if (api !== 'api' || !kayan || !name || rest.length > 0) return null
        const operation = table.get(`${kayan}/${name}`)
        if (!operation) return null
        const read = await boundedBody(request, maxBodyBytes)
        if (read instanceof Response) return read
        const body = await read.text()
        // Keyless: refused before any operation, and the key names an operation's refusal.
        const undecodable = (message: string) => Response.json({ code: codes[400], message }, { status: 400 })
        let input: unknown = {}
        if (body) {
          try {
            input = JSON.parse(body)
          } catch {
            return undecodable('The request body is not JSON.')
          }
          // The runner reads fields off the input, so a body of `null` or `1` would be a
          // 500 a caller provoked; every caller-provoked refusal is a 4xx.
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            return undecodable('The request body is not a JSON object.')
          }
        }
        try {
          // Resolved after the match, so a host's own routes cost no session lookup.
          const decoded = decodeJson(input, operation.input)
          const who = await actor()
          const result = await operation.call(decoded, { actor: who, context: await context?.(request, who), ...draftOptions(request) })
          // Only a write says so, because the browser clears its banner on this value alone.
          return Response.json(result, operation.effect === 'read' ? undefined : { headers: { [afterCommitHeader]: 'ok' } })
        } catch (thrown) {
          if (thrown instanceof AfterCommitError) {
            try {
              onError(thrown.cause)
            } catch {
              // Reporting cannot change a committed result.
            }
            return Response.json(thrown.result, { headers: { [afterCommitHeader]: 'failed' } })
          }
          thrown = retryConflict(thrown)
          if (thrown instanceof AsasError) {
            // The cause is never serialized: a conflict's driver error names the column and
            // value the refusal's message withholds.
            return Response.json(
              { code: codes[thrown.status], data: { key: thrown.key, params: thrown.params }, message: thrown.message },
              { status: thrown.status },
            )
          }
          try {
            onError(thrown)
          } catch {
            // Deliberately empty: reporting may not change what is reported.
          }
          // Not an `AsasError` is the project's own fault, so its message is replaced.
          return Response.json({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }, { status: 500 })
        }
      },
    }
  }
}
