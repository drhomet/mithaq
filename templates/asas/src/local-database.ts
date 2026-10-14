import { parse } from 'pg-connection-string'

/**
 * The database `url` names, as `host:port/name`, and whether it is on this machine, for the scripts that write to a
 * development database; nothing when pg cannot read it. Read by pg's own parser, so the guard and the connection never
 * disagree on the host, and a host left out is pg's default. Nothing of the URL is repeated on a failure, since it
 * holds the password.
 */
export const databaseOf = (url: string) => {
  let config: ReturnType<typeof parse>
  try {
    config = parse(url)
  } catch {
    return undefined
  }
  const host = config.host || process.env.PGHOST || 'localhost'
  return {
    database: `${host}:${config.port || process.env.PGPORT || '5432'}/${config.database ?? ''}`,
    // A path is a socket on this machine.
    local: host.startsWith('/') || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host),
  }
}
