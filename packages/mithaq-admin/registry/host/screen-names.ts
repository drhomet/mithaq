/**
 * The screen a request names, refused unless it is one of `known`'s own keys.
 * The input is whatever a request sent and it indexes `asas.targets`, so
 * `__proto__` and any other name no screen answers is refused before that read.
 */
export const screenNamed = <Known extends object>(known: Known, name: unknown): keyof Known & string => {
  if (typeof name !== 'string' || !Object.hasOwn(known, name)) throw new Error(`"${String(name)}" is no screen of this app.`)
  return name as keyof Known & string
}
