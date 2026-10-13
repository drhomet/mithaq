import { media, type ImageRead } from './media/media.ts'

export type { ImageRead }

/**
 * The feature's kayan, built for the reads beside `media.create` that open an
 * image, which the features pointing at images bring: courses brings the covers
 * of the courses an actor reads. With none, only a holder of `media.create`
 * reads an image.
 */
export const kayan = ({ reads }: { reads: readonly ImageRead[] }) => [media({ reads })] as const
