import { s3, type S3Options } from './s3.ts'

export const r2 = ({ accountId, ...rest }: Omit<S3Options, 'endpoint' | 'region'> & { accountId: string }) =>
  s3({ ...rest, endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: 'auto' })
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 3f592d20f1b51223f76dba6cc10eb9903abcf5084fe8bec1424e5f929769acff
