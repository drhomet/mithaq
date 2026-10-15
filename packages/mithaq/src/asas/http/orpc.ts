// The only file that imports oRPC, so it is its own entry and oRPC stays an
// optional peer a project that serves no HTTP never installs.
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ORPCError, ValidationError, os } from '@orpc/server'
import type { Procedure, Schema } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import type { OperationTable } from '../build.ts'
import { AfterCommitError, AsasError, afterCommitHeader, codes } from '../runner/errors.ts'
import { issueRefusal, withoutPrototype } from '../runner/steps.ts'
import { boundedBody, decodeJson, defaultMaxBodyBytes, draftOptions, tooLarge } from './fetch.ts'
import type { StandardSchemaIssue } from '../../mithaq/standard-schema.ts'

/** The context every procedure is handed, which defaults to the actor alone. */
export type OrpcContext = { actor: unknown } & Record<string, unknown>

export type OrpcHttpOptions = {
  /** Where the typed protocol answers. */
  rpc?: `/${string}`
  /** Where plain HTTP answers, one route per operation. */
  api?: `/${string}`
  /**
   * Builds the context a procedure receives, once per request. The default is `{ actor }`;
   * the `actor` it returns is the one the call runs as.
   */
  context?: (request: Request, actor: unknown) => Promise<OrpcContext> | OrpcContext
  /**
   * Handed every error that is not an `AsasError`, before it is rethrown with its message replaced.
   * A host's own deliberate `ORPCError` reaches it too, so a host logging only faults filters on the code.
   */
  onError?: (error: unknown) => void
  /** The largest body a call takes, answered 413 past it: `defaultMaxBodyBytes` or the project's own. */
  maxBodyBytes?: number
}

// Matched on the `ValidationError` cause, not the shape of `data`, so a host's own
// `BAD_REQUEST` keeps its message and data.
const boundaryRefusal = (thrown: unknown) =>
  thrown instanceof ORPCError && thrown.code === 'BAD_REQUEST' && thrown.cause instanceof ValidationError
    ? issueRefusal(thrown.cause.issues as readonly StandardSchemaIssue[])
    : undefined

// No `.output()`: the runner already projects and parses what it returns.
type OrpcProcedure<Method> = Method extends (...args: infer Args) => Promise<infer Answer>
  ? Procedure<
      OrpcContext,
      OrpcContext,
      Schema<Args[0], Args[0]>,
      Schema<Answer, Answer>,
      Record<never, never>,
      Record<never, never>
    >
  : never

/** The router, typed from the operation table: kayan, then operation. `RouterClient` over it needs no generated code. */
export type OrpcRouter<View> = {
  [Kayan in keyof View]: { [Name in keyof View[Kayan]]: OrpcProcedure<View[Kayan][Name]> }
}

/**
 * The oRPC plug: one procedure per operation, served over both the typed RPC protocol
 * and plain HTTP. Needs `@orpc/server` and `@orpc/openapi`.
 */
export const orpcHttp = ({
  rpc = '/api/rpc',
  api = '/api',
  context,
  onError,
  maxBodyBytes = defaultMaxBodyBytes,
}: OrpcHttpOptions = {}) =>
  <View>(operations: OperationTable<View>) => {
    // A reporter that throws must not replace the error the host has to see.
    const report = (thrown: unknown) => {
      try {
        onError?.(thrown)
      } catch {
        // Deliberately empty: reporting may not change what is reported.
      }
    }
    // Per request, because a procedure's handler cannot read the request itself.
    const warnings = new AsyncLocalStorage<{ said?: 'ok' | 'failed'; options: ReturnType<typeof draftOptions> }>()
    // The one place a refusal becomes a wire error, so both handlers share it.
    const base = os.$context<OrpcContext>().use(async ({ next }) => {
      try {
        return await next()
      } catch (thrown) {
        // oRPC validates the bound input inside this middleware, so its own refusal is
        // re-emitted in the runner's shape: one shape answers every 400 a procedure raises.
        const held = thrown instanceof AsasError ? thrown : boundaryRefusal(thrown)
        if (!held) {
          report(thrown)
          throw thrown
        }
        throw new ORPCError(codes[held.status], {
          message: held.message,
          data: { key: held.key, params: held.params },
          // Never serialize the cause: a conflict's driver error names the column and value
          // on its `detail`. It stays in process only because oRPC's `toJSON` never emits `cause`.
          cause: held,
        })
      }
    })
    // No prototype, so a kayan or operation named `constructor` or `__proto__` is an own key.
    const router: Record<string, Record<string, unknown>> = Object.create(null)
    for (const operation of operations) {
      const kayan = (router[operation.kayan] ??= Object.create(null))
      const input = operation.input
      const zod = input['~standard'].vendor === 'zod'
      // The published shape stays for the OpenAPI contract; only validation is skipped,
      // because the runner parses every input before any store seal, and a draft against the draft shape.
      const wireInput = Object.assign(Object.create(input) as typeof input, {
        '~standard': {
          ...input['~standard'],
          validate: (value: unknown, options?: { readonly libraryOptions?: Record<string, unknown> }) => {
            const decoded = zod ? withoutPrototype(decodeJson(value, input)) : value
            const object = decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)
            return warnings.getStore()?.options.draft && object ? { value: decoded } : input['~standard'].validate(decoded, options)
          },
        },
      })
      kayan[operation.name] = base
        .input(wireInput)
        .handler(async ({ context: held, input }) => {
          try {
            const { actor, ...rest } = held
            const result = await operation.call(input, { actor, context: context ? rest : undefined, ...warnings.getStore()?.options })
            const warning = warnings.getStore()
            if (warning && operation.effect !== 'read') warning.said = 'ok'
            return result
          } catch (thrown) {
            if (!(thrown instanceof AfterCommitError)) throw thrown
            report(thrown.cause)
            const warning = warnings.getStore()
            if (warning) warning.said = 'failed'
            return thrown.result
          }
        })
    }
    const handlers = [
      [rpc, new RPCHandler(router as never)],
      [api, new OpenAPIHandler(router as never)],
    ] as const
    return {
      name: 'orpc',
      router: router as unknown as OrpcRouter<View>,
      /**
       * `null` when neither prefix matched, so a host keeps its own routes. The path is matched
       * before the actor thunk is called, so a host's own route runs no strategy.
       */
      handle: async (request: Request, actor: () => Promise<unknown>): Promise<Response | null> => {
        const { pathname } = new URL(request.url)
        const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)
        if (!handlers.some(([prefix]) => under(prefix))) return null
        // Read here, so oRPC's own reader never holds a body past the limit.
        if (request.body) {
          const read = await boundedBody(request, maxBodyBytes)
          if (!read) return tooLarge(maxBodyBytes)
          request = new Request(request.url, { method: request.method, headers: request.headers, body: read, signal: request.signal })
        }
        // Built before any procedure runs, so a throw here is outside the middleware;
        // it still reaches `onError`.
        let held: OrpcContext
        try {
          const who = await actor()
          held = context ? await context(request, who) : { actor: who }
        } catch (thrown) {
          if (!(thrown instanceof AsasError)) report(thrown)
          throw thrown
        }
        for (const [prefix, handler] of handlers) {
          if (!under(prefix)) continue
          const warning: { said?: 'ok' | 'failed'; options: ReturnType<typeof draftOptions> } = { options: draftOptions(request) }
          const answered = await warnings.run(warning, () => handler.handle(request, { context: held, prefix }))
          if (answered.matched) {
            if (warning.said) answered.response.headers.set(afterCommitHeader, warning.said)
            return answered.response
          }
        }
        return null
      },
    }
  }
