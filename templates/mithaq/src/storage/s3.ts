// An S3 bucket as a mithaq storage adapter, over aws4fetch, so it runs on Node, Bun and
// Workers alike and reaches AWS S3, Cloudflare R2, MinIO and Backblaze B2 the same way.
import { AwsClient } from 'aws4fetch'
import type { StorageAdapter } from 'mithaq'

export type S3Options = {
  /** The service's address without the bucket, such as `https://s3.eu-west-1.amazonaws.com`. */
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /**
   * The bucket folder this project owns, such as `mithaq/asas`, with no slash at either end.
   * The sweep lists nothing outside it, so a bucket other apps share keeps their objects.
   */
  prefix: string
  /** Where the bucket is read publicly, for a kayan that writes `public: true`. */
  publicURL?: string
}

const putSeconds = 600
const getSeconds = 300

const pathOf = (key: string) => key.split('/').map(encodeURIComponent).join('/')

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const text = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name]!)

/**
 * The S3 adapter: uploads are signed PUTs bound to the declared type and size, and downloads
 * are 302s to a signed GET that carries the project's disposition.
 */
export const s3 = ({ endpoint, bucket, region, accessKeyId, secretAccessKey, prefix, publicURL }: S3Options): StorageAdapter => {
  if (!prefix || prefix.startsWith('/') || prefix.endsWith('/') || prefix.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`The S3 adapter's prefix ${JSON.stringify(prefix)} names no folder of the bucket. Name one, such as "mithaq/asas".`)
  }
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region })
  const base = `${endpoint.replace(/\/+$/, '')}/${bucket}`
  const urlOf = (key: string) => `${base}/${pathOf(key)}`
  const signed = async (url: string, init: { method: string; headers?: Record<string, string> }) =>
    (await client.sign(url, { ...init, aws: { signQuery: true, allHeaders: true } })).url
  return {
    prefix,
    uploadInstructions: {
      // Signing the type and size makes the bucket refuse any other body, and signing
      // `If-None-Match: *` makes it refuse a second PUT rather than replace a verified object.
      generate: async ({ filesize, mimeType, key }) => {
        const headers = { 'Content-Type': mimeType, 'Content-Length': String(filesize), 'If-None-Match': '*' }
        return { type: 'http', request: { method: 'PUT', url: await signed(`${urlOf(key)}?X-Amz-Expires=${putSeconds}`, { method: 'PUT', headers }), headers } }
      },
    },
    handleDelete: async ({ key }) => {
      const answered = await client.fetch(urlOf(key), { method: 'DELETE' })
      if (!answered.ok && answered.status !== 404) throw new Error(`S3 refused to delete an object: ${answered.status}.`)
    },
    generateURL: ({ key }) => {
      if (!publicURL) throw new Error('This S3 adapter was given no publicURL, so it has no public address for a file.')
      return `${publicURL.replace(/\/+$/, '')}/${pathOf(key)}`
    },
    staticHandler: async (_request, { doc, disposition }) => {
      const query = new URLSearchParams({ 'X-Amz-Expires': String(getSeconds), 'response-content-disposition': disposition, 'response-content-type': doc.mimeType })
      return new Response(null, { status: 302, headers: { Location: await signed(`${urlOf(doc.key)}?${query}`, { method: 'GET' }) } })
    },
    head: async ({ key }) => {
      const answered = await client.fetch(urlOf(key), { method: 'HEAD' })
      if (answered.status === 404) return null
      if (!answered.ok) throw new Error(`S3 answered a HEAD with ${answered.status}.`)
      return { size: Number(answered.headers.get('content-length')) }
    },
    readHead: async ({ key, bytes }) => {
      const answered = await client.fetch(urlOf(key), { headers: { Range: `bytes=0-${bytes - 1}` } })
      if (!answered.ok) throw new Error(`S3 answered a ranged GET with ${answered.status}.`)
      return new Uint8Array(await answered.arrayBuffer()).subarray(0, bytes)
    },
    list: async function* () {
      let token: string | undefined
      do {
        const query = new URLSearchParams({ 'list-type': '2', prefix: `${prefix}/`, ...(token && { 'continuation-token': token }) })
        const answered = await client.fetch(`${base}?${query}`)
        if (!answered.ok) throw new Error(`S3 answered a list with ${answered.status}.`)
        const xml = await answered.text()
        for (const [, one] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          yield { key: text(one!, 'Key')!, lastModified: new Date(text(one!, 'LastModified')!) }
        }
        token = text(xml, 'IsTruncated') === 'true' ? text(xml, 'NextContinuationToken') : undefined
      } while (token)
    },
  }
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 a6b1f7b3a13ef66fb811f35844279694bfb8f3d08657170fa98e882bc0f5e079
