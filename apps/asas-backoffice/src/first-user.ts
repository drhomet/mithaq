import { createServerFn } from '@tanstack/react-start'

type FirstUser = { initialized: true } | { initialized: false; code: 'none' | 'required' | 'unset' }

/**
 * Whether the backoffice has an administrator yet, and while it has none whether making one asks for
 * the setup code: the provider's own `init`, read in process.
 */
export const firstUser = createServerFn({ method: 'GET' }).handler(async () => {
  // Imported inside the server half so no page ships the provider to the browser.
  const { asas } = await import('asas')
  type Provider = { name: string; server: { api: { init(): Promise<FirstUser> } } }
  return (asas.auth.strategies as unknown as Provider[]).find((one) => one.name === 'user')!.server.api.init()
})
