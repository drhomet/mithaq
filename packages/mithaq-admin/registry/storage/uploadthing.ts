// UploadThing as a mithaq storage adapter for files already stored there: it reads, signs a
// short-lived address and deletes by key, and never uploads, so new files go to another adapter.
import type { StorageAdapter } from 'mithaq'

export type UploadThingOptions = {
  /** `UPLOADTHING_TOKEN`, the base64 JSON that names the API key and the app. */
  token: string
  /** The fetch every request goes through, which a test replaces. */
  fetch?: typeof fetch
}

const getSeconds = 300
const api = 'https://api.uploadthing.com/v6'

export const uploadthing = ({ token, fetch: send = fetch }: UploadThingOptions): StorageAdapter => {
  const { apiKey, appId } = JSON.parse(Buffer.from(token, 'base64').toString()) as { apiKey: string; appId: string }
  const fileURL = (key: string) => `https://${appId}.ufs.sh/f/${encodeURIComponent(key)}`
  const call = async (path: string, body: unknown) => {
    const answered = await send(`${api}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-uploadthing-api-key': apiKey },
      body: JSON.stringify(body),
    })
    if (!answered.ok) throw new Error(`UploadThing answered ${path} with ${answered.status}.`)
    return answered.json() as Promise<Record<string, unknown>>
  }
  return {
    // UploadThing chose these keys and lists none of them, so no sweep ever reaches them.
    prefix: '',
    uploadInstructions: {
      generate: async () => {
        throw new Error('The UploadThing adapter reads and deletes the files already there, and uploads none. Send new uploads to another adapter.')
      },
    },
    handleDelete: async ({ key }) => {
      await call('deleteFiles', { fileKeys: [key] })
    },
    generateURL: ({ key }) => fileURL(key),
    // UploadThing's signed address takes no disposition, so the stored type stands and an SVG
    // stored there is served to draw, not to download.
    staticHandler: async (_request, { doc }) => {
      const { url } = await call('requestFileAccess', { fileKey: doc.key, expiresIn: getSeconds })
      if (typeof url !== 'string') throw new Error('UploadThing answered requestFileAccess with no url.')
      return new Response(null, { status: 302, headers: { Location: url } })
    },
    head: async ({ key }) => {
      const answered = await send(fileURL(key), { method: 'HEAD' })
      if (answered.status === 404) return null
      if (!answered.ok) throw new Error(`UploadThing answered a HEAD with ${answered.status}.`)
      return { size: Number(answered.headers.get('content-length')) }
    },
    readHead: async ({ key, bytes }) => {
      const answered = await send(fileURL(key), { headers: { Range: `bytes=0-${bytes - 1}` } })
      if (!answered.ok) throw new Error(`UploadThing answered a ranged GET with ${answered.status}.`)
      return new Uint8Array(await answered.arrayBuffer()).subarray(0, bytes)
    },
  }
}
