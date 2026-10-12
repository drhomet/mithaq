/**
 * h3 knows its own error by the name `HTTPError` alone. 499 is the status nginx logs for a client
 * that closed its request.
 */
const gone = () =>
  Object.assign(new Error('The client closed the request.'), {
    name: 'HTTPError',
    status: 499,
    statusText: 'Client Closed Request',
    toJSON: () => ({ status: 499, message: 'The client closed the request.' }),
  })

/**
 * The request handed to TanStack Start, whose signal aborts with `gone` when the client's does.
 * Start throws the signal's reason on abort and h3 logs any error that is not its own as an
 * unhandled 500, so a closed tab would be logged as a fault. The request is rebuilt from its parts
 * because the Node server's srvx request is a class `new Request(request)` cannot read.
 */
export const withQuietAbort = (request: Request): Request => {
  const controller = new AbortController()
  if (request.signal.aborted) controller.abort(gone())
  else request.signal.addEventListener('abort', () => controller.abort(gone()), { once: true })
  const { method, headers, body } = request
  return new Request(request.url, { method, headers, body: method === 'GET' || method === 'HEAD' ? null : body, signal: controller.signal, duplex: 'half' } as RequestInit)
}
