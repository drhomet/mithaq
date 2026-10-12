import { defineRukn } from '../mithaq/rukn.ts'
import { defaultKinds } from './kinds.ts'
import { defaultRules } from './rules.ts'

/** The rukn every project lays down first: the shipped kinds and rules. */
export const base = defineRukn({ name: 'base', kinds: defaultKinds, rules: defaultRules })
