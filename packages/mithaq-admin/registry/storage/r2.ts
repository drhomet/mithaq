import { s3, type S3Options } from './s3.ts'

export const r2 = ({ accountId, ...rest }: Omit<S3Options, 'endpoint' | 'region'> & { accountId: string }) =>
  s3({ ...rest, endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: 'auto' })
