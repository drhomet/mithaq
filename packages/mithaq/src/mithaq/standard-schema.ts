// The Standard Schema v1 types, vendored: the spec package ships nothing but these.

/** Anything a schema target derives or a developer writes: one `~standard` member. */
export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly '~standard': StandardSchemaProps<Input, Output>
}

/**
 * What `~standard` carries: the version of the interface, the name of the
 * library that made the schema, the one call that validates, and the two types
 * the schema names for a reader, which exist only at compile time.
 */
export type StandardSchemaProps<Input = unknown, Output = Input> = {
  readonly version: 1
  readonly vendor: string
  readonly validate: (
    value: unknown,
    options?: { readonly libraryOptions?: Record<string, unknown> | undefined },
  ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  readonly types?: { readonly input: Input; readonly output: Output } | undefined
}

/** The value, or the reasons there is none. The absence of issues is success. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] }

/** One reason: the message a caller reads, and where in the value it happened. */
export type StandardSchemaIssue = {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

/** The value a schema takes, before its own transforms run. */
export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['input']
/** The value a schema returns, after them. */
export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['output']
