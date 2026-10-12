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
