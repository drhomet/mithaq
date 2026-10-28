import type { ResolvedField, ResolvedKayan } from '../mithaq/types.ts'

// Free of the server runner, so the device runner checks rich-text uploads through the same code.
// Only uploads opted into row cleanup need application-held locks for JSON references.
export const cleanupUploadTargets = new WeakMap<ResolvedField, readonly ResolvedKayan[]>()
export const richTextUploads = (value: unknown): { kayan: string; id: unknown }[] => {
  if (!value || typeof value !== 'object') return []
  const node = value as Record<string, unknown>
  const own = node.type === 'upload' && typeof node.relationTo === 'string' && node.value != null ? [{ kayan: node.relationTo, id: node.value }] : []
  return [...own, ...Object.values(node).flatMap((child) => richTextUploads(child))]
}
