/**
 * The headers a page's server-side `request` call sends: the session's, with
 * the loader's own layered over them. The session's cookie always wins, so a
 * loader's headers cannot act as another actor.
 */
export const mergedHeaders = (session: Headers, own?: HeadersInit): Headers => {
  const headers = new Headers(session)
  if (own) for (const [key, value] of new Headers(own)) if (key !== 'cookie') headers.set(key, value)
  return headers
}
// mithaq-admin 2d3ab739c92c6c2b397041b76bf4b23b2902b7a2 2969a3dafbf201d6eb6074ecda0e8f17e341cbd1ca176100350844e74ec23623
