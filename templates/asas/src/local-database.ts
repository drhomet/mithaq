/**
 * The database `url` names, as `host:port/name`, and whether it is on this machine, for the scripts that write to a
 * development database. pg takes a `?host=` and a `?port=` over the URL's own, the last one when repeated, and a path
 * there is a socket on this machine.
 */
export const databaseOf = (url: string) => {
  const { hostname, port, pathname, searchParams } = new URL(url)
  const host = searchParams.getAll('host').at(-1) || hostname
  return {
    database: `${host}:${searchParams.getAll('port').at(-1) || port || '5432'}/${decodeURIComponent(pathname.slice(1))}`,
    local: host.startsWith('/') || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host),
  }
}
