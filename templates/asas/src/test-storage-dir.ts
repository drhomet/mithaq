// A folder of the run's own for the template's local storage, set before `./storage/index.ts` reads it,
// so a test that uploads writes no file into the checkout. Imported first so it runs before that module.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'mithaq-asas-storage-'))
