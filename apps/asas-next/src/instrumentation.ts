// Next finishes `register` before the server handles a request, so a production start refuses
// to run while a migration is unapplied. Edge also calls `register`, hence the runtime check.
// `next dev` pushes nothing on its own.
export const register = async () => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return
  const { asas } = (await import(/* webpackIgnore: true */ 'asas')) as typeof import('asas')
  // A refused start exits 1 rather than leave a server up that cannot serve.
  await asas.connect().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
