// No imports, so `mithaq/admin` hands it to the browser without the server's crypto.

const svg = 'image/svg+xml'

/**
 * Whether a type is one a kayan takes: `image/*` takes every `image/` type except
 * SVG, a document that runs script, which is taken only where the list names it.
 */
export const allowedType = (type: string, mimeTypes: readonly string[]) =>
  type === svg ? mimeTypes.includes(svg) : mimeTypes.some((one) => type.startsWith(one.replace('*', '')))
