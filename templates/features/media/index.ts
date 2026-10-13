import { media, type ImageRead } from './media/media.ts'

export type { ImageRead }

/**
 * The feature's kayan, built for the reads beside `media.create` that open an
 * image, which each feature whose rows point at images brings and the asas
 * hands in. With none, only a holder of `media.create` reads an image.
 */
export const kayan = ({ reads }: { reads: readonly ImageRead[] }) => [media({ reads })] as const
