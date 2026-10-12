import { randomUUID } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { imageDimensionsFromData } from 'image-dimensions'
import {
  adapterOf,
  allowedType,
  checkReference,
  fileHeaders,
  invalid,
  readForFile,
  sanitizeFilename,
  signReference,
  type StorageConfig,
  type StorageKayan,
} from 'mithaq'

/**
 * `<prefix>/<tenant>/<kayan>/<id>/<filename>`, under the adapter's prefix, the
 * one folder its sweep lists. The id is the row's own, so two files of one name never meet.
 */
export const defaultKey: StorageConfig['key'] = ({ prefix, tenant, kayan, id, filename }) =>
  [...(prefix ? [prefix] : []), (tenant ?? '_').replaceAll('/', '_'), kayan, id, filename].join('/')

/** The bytes `file-type` reads to tell a type, its own `reasonableDetectionSizeInBytes`. */
const sniffed = 4100

/**
 * Checks the stored object is there, of the declared size and no larger than the kayan takes,
 * and of the declared type as its first bytes tell it, and reads an image's width and height.
 * A type the bytes cannot tell, such as text/plain, CSV or JSON, is refused; SVG is the one text type taken.
 */
export const defaultVerify: StorageConfig['verify'] = async ({ adapter, key, mimeType, size, mimeTypes, fileSize }) => {
  const head = await adapter.head({ key })
  if (!head) return { refused: 'No file was uploaded.' }
  if (head.size !== size) return { refused: `The file holds ${head.size} bytes, and ${size} were declared.` }
  if (head.size > fileSize) return { refused: `The file holds more than ${fileSize} bytes.` }
  const bytes = await adapter.readHead({ key, bytes: sniffed })
  const read = (await fileTypeFromBuffer(bytes))?.mime
  const svg = (!read || read === 'application/xml') && /<svg[\s>]/i.test(new TextDecoder().decode(bytes))
  const type = svg ? 'image/svg+xml' : read
  if (type !== mimeType) return { refused: `The file is ${type ?? 'of no type a file can be told by'}, and ${mimeType} was declared.` }
  if (!allowedType(type, mimeTypes)) return { refused: `The file is ${type}, which this kayan does not hold.` }
  const measured = imageDimensionsFromData(bytes)
  return { width: measured?.width ?? null, height: measured?.height ?? null }
}

/** The types a browser draws in place and runs nothing in. Everything else is downloaded. */
const drawn = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf)$/

/**
 * `inline` for a raster image and a PDF, `attachment` for every other type, an SVG among them,
 * with the uploaded name (RFC 6266: `filename` for old clients, `filename*` for the rest).
 */
export const defaultDisposition: StorageConfig['disposition'] = ({ filename, mimeType }) => {
  const plain = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (one) => `%${one.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${drawn.test(mimeType) ? 'inline' : 'attachment'}; filename="${plain}"; filename*=UTF-8''${encoded}`
}

/** How long an object may sit with no row naming it before it is swept: an upload in flight has an hour. */
const day = 24 * 60 * 60 * 1000

/** Removes every object older than a day that no row names, or with `check` lists them and leaves them. */
export const defaultSweep: StorageConfig['sweep'] = async ({ adapter, named, check, now }) => {
  const orphans: string[] = []
  for await (const { key, lastModified } of adapter.list!()) {
    if (named.has(key) || now.getTime() - lastModified.getTime() < day) continue
    orphans.push(key)
    if (!check) await adapter.handleDelete({ key })
  }
  return orphans
}

/**
 * Answers `uploadInstructions` once core has checked the create permission: validates the request,
 * then returns the row's id, the reference core signs for it and the adapter's signed request.
 */
export const defaultUploadInstructions: StorageConfig['instructions'] = async ({ kayan, input, actor }) => {
  const asked = input as Record<string, unknown> | null
  if (
    !asked || typeof asked !== 'object' || Array.isArray(asked)
    || typeof asked.filename !== 'string' || asked.filename.length > 255
    || typeof asked.mimeType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(asked.mimeType)
    || !Number.isSafeInteger(asked.filesize) || (asked.filesize as number) < 1
  ) {
    throw invalid({ message: 'An upload names its filename, 255 characters at most, its mimeType, a type such as image/png, and its filesize, a whole number of bytes above 0.', key: 'error.invalid.upload_request', params: { kayan: kayan.name } })
  }
  const filename = sanitizeFilename(asked.filename as string)
  const mimeType = asked.mimeType as string
  const filesize = asked.filesize as number
  if (!filename) throw invalid({ message: 'The file has no name left once its folders and control characters are dropped.', key: 'error.invalid.upload_request', params: { kayan: kayan.name } })
  if (!allowedType(mimeType, kayan.storage.mimeTypes)) {
    throw invalid({ message: `A "${kayan.name}" file may not be of type "${mimeType}".`, key: 'error.invalid.upload_type', params: { kayan: kayan.name, type: mimeType } })
  }
  if (filesize > kayan.storage.fileSize) {
    throw invalid({ message: `A "${kayan.name}" file holds ${kayan.storage.fileSize} bytes at most.`, key: 'error.invalid.upload_size', params: { kayan: kayan.name, max: kayan.storage.fileSize } })
  }
  const uploadReference = signReference({ kayan, actor, id: randomUUID(), filename, type: mimeType, size: filesize })
  const request = await adapterOf({ kayan, name: uploadReference.storage }).uploadInstructions.generate({ filename, filesize, mimeType, key: uploadReference.key })
  return { ...request, file: { filename, mimeType, size: filesize, uploadReference } }
}

/**
 * The create's step: checks the reference, runs the project's `verify` and writes every file column
 * from what the server measured. It runs before the transaction so no lock is held while the object is read.
 */
export const defaultUploaded: StorageConfig['uploaded'] = async (ctx) => {
  const reference = await checkReference({ kayan: ctx.kayan, value: ctx.data.uploadReference, actor: ctx.actor })
  const { storage } = ctx.kayan as StorageKayan
  const adapter = adapterOf({ kayan: ctx.kayan, name: reference.storage })
  const verified = await storage.config.verify({ adapter, key: reference.key, mimeType: reference.type, size: reference.size, mimeTypes: storage.mimeTypes, fileSize: storage.fileSize })
  if ('refused' in verified) {
    throw invalid({ message: `The uploaded file was refused: ${verified.refused}`, key: 'error.invalid.upload_verify', params: { kayan: ctx.kayan.name } })
  }
  const { uploadReference: _used, ...data } = ctx.data
  return {
    ...ctx,
    data: {
      ...data,
      id: reference.id,
      key: reference.key,
      storage: reference.storage,
      filename: reference.filename,
      mimeType: reference.type,
      filesize: reference.size,
      width: verified.width ?? null,
      height: verified.height ?? null,
    },
  }
}

/**
 * Deletes the removed row's object after the commit, so a failure leaves an orphan for the sweep,
 * never a row naming no object. A kayan that marks its rows deleted keeps the object for a restore.
 */
export const defaultRemoveFile: StorageConfig['removed'] = async (ctx) => {
  if (ctx.kayan.softDelete) return ctx
  const row = ctx.dataBefore ?? ctx.data
  if (typeof row.key === 'string') await adapterOf({ kayan: ctx.kayan, name: row.storage }).handleDelete({ key: row.key })
  return ctx
}

/**
 * `GET /api/<kayan>/file/<id>`: reads the row through core's read gate, where every miss is the same 404,
 * then answers with the adapter's redirect or bytes under the project's `disposition`.
 */
export const defaultServeFile: StorageConfig['serve'] = async ({ request, kayan, id, read }) => {
  const doc = await readForFile({ kayan, id, read })
  const adapter = adapterOf({ kayan, name: doc.storage })
  return fileHeaders({
    doc,
    disposition: kayan.storage.config.disposition({ filename: doc.filename, mimeType: doc.mimeType }),
    answer: ({ disposition }) => adapter.staticHandler(request, { doc, disposition }),
  })
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 af2cd4436012c35d6e1d868b3f5cc2efec50c61983d2559609ebec55d1b4acf5
