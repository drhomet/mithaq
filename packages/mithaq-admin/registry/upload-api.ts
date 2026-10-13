import { allowedType, type FetchClient } from 'mithaq/admin'
import type { Translate } from './copy.ts'
import { refusalKeyOf } from './refusal.ts'

export type Row = Record<string, unknown>

type UploadRequest = { method: 'PUT' | 'POST'; url: string; headers?: Record<string, string> }
type UploadInstructions = { request: UploadRequest; file: { uploadReference: unknown } }

/** The copy key of the refusal the server would answer for a file of this type and size, or nothing. The server checks both again, and reads the bytes besides. */
export const refusedFile = (file: { type: string; size: number }, storage?: { mimeTypes: readonly string[]; fileSize: number }): string | undefined => {
  if (!storage) return undefined
  if (!allowedType(file.type, storage.mimeTypes)) return 'error.invalid.upload_type'
  if (file.size > storage.fileSize) return 'error.invalid.upload_size'
  return file.size < 1 ? 'error.invalid.upload_request' : undefined
}

/** The refusals about the file itself, which sending it again meets again, so no retry is offered. A failed send, a 412 or a 5xx may pass a second time. */
const final = new Set(['error.invalid.upload_type', 'error.invalid.upload_size', 'error.invalid.upload_verify'])

const vendorNames: Readonly<Record<string, string>> = {
  'vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'vnd.ms-excel': 'XLS',
  'msword': 'DOC',
}

/**
 * A file type as a person names it, the subtype in capitals (`image/png` is PNG), since the raw
 * type reads as a path and breaks at its slash in an Arabic sentence. A vendor type is named by
 * its extension where well known, else by the last part of its name. A wildcard such as `image/*` is kept whole.
 */
export const typeName = (mimeType: string): string => {
  const [type = '', subtype = ''] = mimeType.split('/')
  if (!subtype || subtype === '*') return type ? `${type}/*` : mimeType
  const bare = subtype.split('+')[0]!
  return Object.hasOwn(vendorNames, bare) ? vendorNames[bare]! : bare.replace(/^(x-|vnd\.)/, '').split('.').at(-1)!.toUpperCase()
}

/** The types a kayan takes, each named once, in the order the kayan lists them. */
export const typeNames = (mimeTypes: readonly string[]): string[] => [...new Set(mimeTypes.map(typeName))]

/** A size in bytes as a person reads it: bytes, kilobytes or megabytes (1024 each), every unit written out because the platform's short forms mix words with abbreviations. */
export const sizeOf = (bytes: number, locale: string): string => {
  const [value, unit] = bytes < 1024 ? [bytes, 'byte'] : bytes < 1024 * 1024 ? [bytes / 1024, 'kilobyte'] : [bytes / (1024 * 1024), 'megabyte']
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 1 }).format(value)
}

/** The words of a refusal: the project's copy under the key the server sent, and the server's own sentence where the copy holds none. */
export const refusalOf = (thrown: unknown, t: Translate) => {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  const key = refusalKeyOf(thrown)
  return { words: (key && t(key, message)) || message, retry: !final.has(key ?? '') }
}

/** Headers a browser sets itself and refuses from a script, which the S3 adapter signs and the browser sends anyway. */
const forbidden = new Set(['content-length', 'host'])

/** The bytes sent where the instructions say, with progress as a fraction. Over `XMLHttpRequest` because `fetch` reports no upload progress. */
export const put = ({ request, file, progress }: { request: UploadRequest; file: Blob; progress: (fraction: number) => void }) =>
  new Promise<void>((resolve, reject) => {
    const sending = new XMLHttpRequest()
    sending.open(request.method, request.url)
    for (const [name, value] of Object.entries(request.headers ?? {})) if (!forbidden.has(name.toLowerCase())) sending.setRequestHeader(name, value)
    sending.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(event.loaded / event.total)
    }
    sending.onload = () => {
      if (sending.status >= 200 && sending.status < 300) return resolve()
      let message = `HTTP ${sending.status}`
      try {
        const said = (JSON.parse(sending.responseText) as { message?: unknown }).message
        if (typeof said === 'string') message = said
      } catch {
        // A store's own refusal is often XML; the status is what is left to say.
      }
      reject(Object.assign(new Error(message), { status: sending.status }))
    }
    sending.onerror = () => reject(new Error('The file could not be sent.'))
    sending.send(file)
  })

/** The whole upload in the three steps the server asks for: the instructions, the bytes, then the create carrying the signed reference beside the row's own fields. Answers the row the create made. */
export const uploadFile = async ({ client, kayan, file, data, progress, send = put }: {
  client: FetchClient
  kayan: string
  file: File
  data: Row
  progress: (fraction: number) => void
  send?: typeof put
}): Promise<Row> => {
  const instructions = (await client({ kayan, operation: 'uploadInstructions', input: { filename: file.name, filesize: file.size, mimeType: file.type } })) as UploadInstructions
  await send({ request: instructions.request, file, progress })
  progress(1)
  return (await client({ kayan, operation: 'create', input: { ...data, uploadReference: instructions.file.uploadReference } })) as Row
}
