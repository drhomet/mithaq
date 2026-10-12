// Loaded by Node and never bundled: a screen's `ui()` URLs resolve off the file that declares
// them, and a bundled copy would read a folder beside the bundle.
const { asas } = (await import(/* webpackIgnore: true */ 'asas')) as typeof import('asas')

const handle = asas.handler

export const GET = handle
export const HEAD = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
