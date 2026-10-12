/**
 * A reference to the actor's value at one key. `T` is never written or read; it
 * carries the value's type into the operator the reference is compared with.
 */
export type Ref<T = unknown> = { $user: string; __value?: T }

/** One reference per key of the actor. */
export type UserRefs<Actor> = { readonly [Key in keyof Actor]-?: Ref<NonNullable<Actor[Key]>> }

// Frozen, so a row stays data that a query, a form and `JSON.stringify` read without executing anything.
const refs: { readonly [key: string]: Ref<never> } = new Proxy(Object.freeze({}), {
  // `refs[Symbol.iterator]` must be nothing, or the operand check reads it as a literal.
  get: (_target, key) => (typeof key === 'symbol' ? undefined : Object.freeze({ $user: key })),
})

/** The actor accessor for a project's own shipped fields, typed by the actor the caller names. */
export const userRefs = <Actor>() => refs as unknown as UserRefs<Actor>

export const user = refs

export const isRef = (value: unknown): value is Ref =>
  typeof value === 'object' && value !== null && typeof (value as Ref).$user === 'string'

// Refused, so a row still holding a `$CURRENT_USER.` string fails loudly rather than resolving to nothing.
export const refuseLiteral = (value: unknown, where: string) => {
  if (typeof value !== 'string' || !value.startsWith('$CURRENT_USER.')) return
  const key = value.slice('$CURRENT_USER.'.length)
  throw new Error(
    `${where} names the actor as the string "${value}". That form is gone: write \`user.${key}\`, with the \`user\` \`defineMithaq\` hands back, or \`userRefs<Actor>()\` where the language does not exist yet.`,
  )
}
