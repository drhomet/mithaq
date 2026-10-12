import type { Kind } from '../base/kinds.ts'
import type { Rule } from '../base/rules.ts'
import type { RuntimeTarget } from './language.ts'

export type Rukn = {
  readonly name: string
  readonly kinds?: Readonly<Record<string, Kind>>
  readonly rules?: Readonly<Record<string, Rule>>
  readonly targets?: Readonly<Record<string, RuntimeTarget>>
  readonly needs?: readonly string[]
}

/** Declares a rukn, one pillar of capability (kinds, rules, targets and what it needs), keeping its literal types. */
export const defineRukn = <const R extends Rukn>(rukn: R): R => rukn

/** What a kayan writes under one of the build's targets, by that target's `type`; each target's folder augments it. */
export interface KayanConfigs<L, F, T> {}

/** What a kayan writes under target `T` of language `L`, by `T`'s type. */
export type KayanConfigOf<L, F, T> = T extends { readonly type: infer Type }
  ? Type extends keyof KayanConfigs<L, F, T>
    ? KayanConfigs<L, F, T>[Type]
    : unknown
  : unknown

type U2I<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never
type Index<A> = keyof A & `${number}`
type Brought<R, K extends 'kinds' | 'rules' | 'targets'> = R extends { readonly [P in K]: infer X extends object } ? X : {}

/** Every rukn's `K`, as one record. */
export type ArkanOf<A extends readonly Rukn[], K extends 'kinds' | 'rules' | 'targets'> = U2I<{ [I in Index<A>]: Brought<A[I], K> }[Index<A>]> &
  Record<never, never>

/** The names of `K` that two arkan of `A` both bring. */
type Twice<A extends readonly Rukn[], K extends 'kinds' | 'rules' | 'targets'> = {
  [I in Index<A>]: keyof Brought<A[I], K> & { [J in Index<A>]: J extends I ? never : keyof Brought<A[J], K> }[Index<A>]
}[Index<A>] &
  string

type CapabilitiesOf<Targets> = {
  [Name in keyof Targets]: Targets[Name] extends { readonly capability: infer Capability extends string } ? Capability : never
}[keyof Targets]

// Each refusal is a key the language must carry and cannot, so the compiler's sentence names it.
export type ArkanRefusals<A extends readonly Rukn[], Targets> = {
  [Name in Twice<A, 'kinds'> as `kind "${Name}" is claimed by two arkan`]: never
} & {
  [Name in Twice<A, 'rules'> as `rule "${Name}" is claimed by two arkan`]: never
} & {
  [Name in Twice<A, 'targets'> as `target "${Name}" is built by two arkan`]: never
} & {
  [Clash in {
    [I in Index<A>]: `target "${keyof Brought<A[I], 'targets'> & keyof Targets & string}" is laid down by the project and built by rukn "${A[I]['name']}"`
  }[Index<A>]]: never
} & {
  [Need in {
    [I in Index<A>]: A[I] extends { readonly needs: readonly (infer N extends string)[] }
      ? `rukn "${A[I]['name']}" needs a target of capability "${Exclude<N, CapabilitiesOf<Targets & ArkanOf<A, 'targets'>>>}"`
      : never
  }[Index<A>]]: never
}

// Refuses nothing, so a clash still reaches `buildAsas`, which names both sides.
export const composeArkan = ({ arkan = [], targets }: { arkan?: readonly Rukn[]; targets?: Readonly<Record<string, RuntimeTarget>> }) => ({
  kinds: Object.assign({}, ...arkan.map((rukn) => rukn.kinds)) as Record<string, Kind>,
  rules: Object.assign({}, ...arkan.map((rukn) => rukn.rules)) as Record<string, Rule>,
  targets: Object.assign({}, ...arkan.map((rukn) => rukn.targets), targets) as Record<string, RuntimeTarget>,
})

// First match wins: the project's own entry in the target's table, then the kind's own, then the shipped one.
export const implementationOf = <Built>({
  table,
  shipped,
  name,
  own,
  type,
}: {
  table: Readonly<Record<string, Built>>
  shipped?: Readonly<Record<string, unknown>>
  name: string
  own: Readonly<Record<string, unknown>> | undefined
  type: string | undefined
}): Built | undefined => {
  const entry = Object.hasOwn(table, name) ? table[name] : undefined
  if (entry !== undefined && entry !== shipped?.[name]) return entry
  return ((type !== undefined && own && Object.hasOwn(own, type) ? own[type] : undefined) as Built | undefined) ?? entry
}
