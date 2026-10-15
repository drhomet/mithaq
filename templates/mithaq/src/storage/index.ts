// Where this project's files go, every piece named here and nothing taken
// from core by default: the language lays down `storage(storageConfig)`, whose
// target holds this config, and a kayan holding files names the `uploaded` and
// `removed` below in its own create and delete. It holds the secret every
// upload reference is signed with, so it is imported by the server's modules
// alone: the screens read their generated `screen.json` and never the language.
// The adapters and `defaults.ts` beside this file are copied from the
// `mithaq-storage` registry item and owned by the project: `mithaq upgrade
// --check` reports one that was edited, and an edit is merged by hand.
import { randomBytes } from 'node:crypto'
import { defaultFileSize, defaultMaxBodyBytes, type StorageConfig } from 'mithaq'
import {
  defaultDisposition,
  defaultKey,
  defaultRemoveFile,
  defaultServeFile,
  defaultSweep,
  defaultUploaded,
  defaultUploadInstructions,
  defaultVerify,
} from './defaults.ts'
import { local } from './local.ts'
import { r2 } from './r2.ts'

const production = process.env.NODE_ENV === 'production'
/** A production boot names every setting below, so none falls back where it would surprise anyone. */
const required = (name: string, fallback: string) => {
  const value = process.env[name]
  if (value) return value
  if (production) throw new Error(`A production boot needs ${name}: ${explained[name]}`)
  return fallback
}
const explained: Record<string, string> = {
  STORAGE_SECRET: 'every upload reference is signed with it.',
  STORAGE_PREFIX: 'the folder of the bucket this project owns, which every key starts with and the sweep lists alone.',
  STORAGE_ADAPTER: 'which adapter new uploads go to, "r2" or "local", named so a missing setting never sends files to the server\'s own disk.',
}

/**
 * What upload references and local upload tokens are signed with. In
 * development a fresh random one per process does: nobody can forge a
 * reference with it, and an upload in flight across a restart is asked for
 * again, since a reference lasts an hour. Said once, so nobody runs several
 * instances on it by accident.
 */
const secret = required('STORAGE_SECRET', randomBytes(32).toString('base64url'))
if (!process.env.STORAGE_SECRET) console.warn('STORAGE_SECRET is not set, so this process signs uploads with a secret of its own, which another process refuses.')

const prefix = required('STORAGE_PREFIX', 'mithaq/asas')

/** R2's four settings, all or none. */
const r2Settings = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const
const r2Unset = r2Settings.filter((name) => !process.env[name])
if (r2Unset.length && r2Unset.length < r2Settings.length) {
  throw new Error(`R2 is half set: ${r2Unset.join(', ')} ${r2Unset.length === 1 ? 'is' : 'are'} missing. Set all four, or none.`)
}

/** Every adapter by the name a row's `storage` column holds: R2 where its four settings are set, and a folder always. */
const adapters: StorageConfig['adapters'] = {
  local: local({ dir: process.env.STORAGE_DIR ?? '.storage', secret, prefix }),
  ...(!r2Unset.length && {
    r2: r2({
      accountId: process.env.R2_ACCOUNT_ID!,
      bucket: process.env.R2_BUCKET!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      prefix,
    }),
  }),
}

/** Where new uploads go, named: the folder in development unless told otherwise. */
const adapter = required('STORAGE_ADAPTER', 'local')
if (!Object.hasOwn(adapters, adapter)) {
  throw new Error(`STORAGE_ADAPTER names "${adapter}", which is none of ${Object.keys(adapters).map((one) => `"${one}"`).join(', ')}. R2 needs its four settings.`)
}

export const storageConfig: StorageConfig = {
  secret,
  adapters,
  adapter,
  // The largest file a kayan holds when its targets.storage names no fileSize.
  fileSize: defaultFileSize,
  // The largest instructions request read; files themselves never come this way.
  maxBodyBytes: defaultMaxBodyBytes,
  key: defaultKey,
  verify: defaultVerify,
  disposition: defaultDisposition,
  sweep: defaultSweep,
  instructions: defaultUploadInstructions,
  uploaded: defaultUploaded,
  removed: defaultRemoveFile,
  serve: defaultServeFile,
  // What a file route threw that is no refusal, before it answers 500. The
  // console is this project's log; a project with an error tracker names it here.
  onError: console.error,
}
