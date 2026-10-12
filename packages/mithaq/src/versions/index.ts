import { defineRukn } from '../mithaq/rukn.ts'

/** `max` is how many versions of one row are kept, the oldest deleted past it; `0` keeps every one. */
export type VersionsTarget = {
  readonly capability: 'versions'
  readonly type: 'versions'
  readonly max: number
}

/** What a kayan writes under the versions target: whether it keeps drafts, autosave, and its own window. */
export type KayanVersions = {
  readonly drafts?: true | { readonly autosave?: true | { readonly interval: number } }
  readonly max?: number
}

/** The versions target, keeping `max` versions of a row where a kayan names no window of its own. */
export const versionsTarget = ({ max }: { max: number }): VersionsTarget => ({ capability: 'versions', type: 'versions', max })

declare module '../mithaq/rukn.ts' {
  interface KayanConfigs<L, F, T> {
    versions: KayanVersions
  }
}

/**
 * The rukn a project lays down for versions and drafts: `arkan: [base, versions({ max: 100 })]`.
 * Each kayan that keeps versions writes `targets.versions` and spreads `versionOperations`.
 */
export const versions = ({ max }: { max: number }) =>
  defineRukn({ name: 'versions', targets: { versions: versionsTarget({ max }) }, needs: ['store'] })
