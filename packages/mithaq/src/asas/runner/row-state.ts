import type { ResolvedKayan } from '../../mithaq/types.ts'
import { combineWhere, type Where } from '../../mithaq/where.ts'

// `exists` rather than `equals: null`: it asks about the column, which every store
// answers alike. The access target's reader never asks it, so `buildAsas` refuses the pair.
export const aliveWhere = (kayan: ResolvedKayan): Where | undefined =>
  kayan.softDelete ? { [kayan.softDelete]: { exists: false } } : undefined

// A row made as a draft and never published is read by nothing but a draft read.
export const publishedWhere = (kayan: ResolvedKayan): Where | undefined =>
  combineWhere(aliveWhere(kayan), kayan.versions?.drafts ? { _status: { equals: 'published' } } : undefined)

