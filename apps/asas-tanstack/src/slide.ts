/**
 * The provider's own session read, which refreshes a session past its `updateAge` and forwards the cookie.
 * Run it before the actor is resolved: a read that refreshes the row first leaves this one nothing due.
 */
export const slide = async ({
  strategies,
  headers,
  setResponseHeader,
}: {
  strategies: readonly unknown[]
  headers: Headers
  setResponseHeader: (name: 'set-cookie', value: string[]) => void
}) => {
  const cookies: string[] = []
  for (const strategy of strategies) {
    const read = (strategy as { server?: { api?: { getSession?: (args: object) => Promise<{ headers: Headers }> } } }).server?.api?.getSession
    if (read) cookies.push(...(await read({ headers, returnHeaders: true })).headers.getSetCookie())
  }
  // Set once with every strategy's cookies: a second set replaces the first.
  if (cookies.length) setResponseHeader('set-cookie', cookies)
}
// mithaq-admin 2d3ab739c92c6c2b397041b76bf4b23b2902b7a2 bc0221e1088103f8638e0333b84aafb6b326e3991a187ced198bce2d090ecbe9
