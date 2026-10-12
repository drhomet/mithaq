// A folder on this machine as a mithaq storage adapter, for development and CI. A folder has
// no signed URLs, so an upload is a PUT to `<route>/<token>`, the token signed for one key,
// type and size; the bytes become the object only when their count is exactly the size signed.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { StorageAdapter } from 'mithaq'

export type LocalOptions = {
  dir: string
  /** What the upload tokens are signed with, 32 characters at least. */
  secret: string
  /** The folder under `dir` this project's keys start with, and the one the sweep lists. */
  prefix: string
  /** The path the upload route answers under, `/api/storage/local` unless named. */
  route?: string
}

const tokenSeconds = 600

type Token = { key: string; type: string; size: number; exp: number }

const refused = (status: number, message: string) => Response.json({ message }, { status })

/**
 * The local adapter. A key that leaves `dir`, or holds an empty, `.` or `..` part, a backslash
 * or a NUL, is refused before any file is touched, whoever handed it in.
 */
export const local = ({ dir, secret, prefix, route = '/api/storage/local' }: LocalOptions): StorageAdapter => {
  if (secret.length < 32) throw new Error('The local storage adapter signs its uploads with a secret of 32 characters at least.')
  if (!prefix || prefix.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`The local storage adapter's prefix ${JSON.stringify(prefix)} names no folder. Name one, such as "mithaq/asas".`)
  }
  const root = resolve(dir)
  const pathOf = (key: string) => {
    if (typeof key !== 'string' || !key || /[\\\0]/.test(key) || key.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error(`The key ${JSON.stringify(key)} names no file inside the storage folder.`)
    }
    const full = resolve(root, key)
    if (!full.startsWith(root + sep)) throw new Error(`The key ${JSON.stringify(key)} names no file inside the storage folder.`)
    return full
  }
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('base64url')
  const tokenOf = (token: Token) => {
    const body = Buffer.from(JSON.stringify(token)).toString('base64url')
    return `${body}.${sign(body)}`
  }
  const held = (token: string): Token | undefined => {
    const [body = '', signature = ''] = token.split('.')
    const given = Buffer.from(signature)
    const expected = Buffer.from(sign(body))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
    const read = JSON.parse(Buffer.from(body, 'base64url').toString()) as Token
    return read.exp * 1000 < Date.now() ? undefined : read
  }
  return {
    prefix,
    uploadInstructions: {
      generate: async ({ filesize, mimeType, key }) => {
        pathOf(key)
        const token = tokenOf({ key, type: mimeType, size: filesize, exp: Math.floor(Date.now() / 1000) + tokenSeconds })
        return { type: 'http', request: { method: 'PUT', url: `${route}/${token}`, headers: { 'Content-Type': mimeType } } }
      },
    },
    handler: async (request) => {
      const { pathname } = new URL(request.url)
      if (request.method !== 'PUT' || !pathname.startsWith(`${route}/`)) return null
      const token = held(pathname.slice(route.length + 1))
      if (!token) return refused(403, 'The upload token is not one this server signed, or it has expired.')
      if (request.headers.get('content-type') !== token.type) return refused(400, 'The upload is not of the type that was signed.')
      let path: string
      try {
        path = pathOf(token.key)
      } catch {
        return refused(400, 'The upload names no file inside the storage folder.')
      }
      await mkdir(dirname(path), { recursive: true })
      const partial = `${path}.${randomUUID()}.part`
      const file = await open(partial, 'wx')
      let written = 0
      try {
        try {
          const reader = request.body?.getReader()
          while (reader) {
            const { done, value } = await reader.read()
            if (done) break
            written += value.byteLength
            if (written > token.size) return refused(400, 'The upload is larger than the size that was signed.')
            await file.write(value)
          }
        } finally {
          await file.close()
        }
        if (written !== token.size) return refused(400, 'The upload is not the size that was signed.')
        // A second PUT with the same token must not change an object its create already
        // verified: a link fails where the object exists, where a rename would replace it.
        try {
          await link(partial, path)
        } catch (error) {
          if ((error as { code?: unknown }).code === 'EEXIST') return refused(409, 'This upload was already sent.')
          throw error
        }
        return new Response(null, { status: 204 })
      } finally {
        await rm(partial, { force: true })
      }
    },
    handleDelete: async ({ key }) => {
      await rm(pathOf(key), { force: true })
    },
    staticHandler: async (_request, { doc }) => {
      const path = pathOf(doc.key)
      const { size } = await stat(path)
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { status: 200, headers: { 'Content-Length': String(size) } })
    },
    head: async ({ key }) => {
      const found = await stat(pathOf(key)).catch(() => undefined)
      return found?.isFile() ? { size: found.size } : null
    },
    readHead: async ({ key, bytes }) => {
      const file = await open(pathOf(key))
      try {
        const buffer = new Uint8Array(bytes)
        const { bytesRead } = await file.read(buffer, 0, bytes, 0)
        return buffer.subarray(0, bytesRead)
      } finally {
        await file.close()
      }
    },
    // The prefix's folder alone, so another project sharing `dir` keeps its files.
    list: async function* () {
      const entries = await readdir(resolve(root, prefix), { recursive: true, withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const path = resolve(entry.parentPath, entry.name)
        yield { key: relative(root, path).split(sep).join('/'), lastModified: (await stat(path)).mtime }
      }
    },
  }
}
