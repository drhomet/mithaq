import { buildAsas } from '../asas/build.ts'
import { defineMithaqWith, type CheckedLanguage, type Composed, type Defined, type Language } from './language-core.ts'
export * from './language-core.ts'

export const defineMithaq = <const L>(language: L & CheckedLanguage<L>): Defined<Extract<Composed<L>, Language>> =>
  defineMithaqWith<L>({ language, build: buildAsas })
