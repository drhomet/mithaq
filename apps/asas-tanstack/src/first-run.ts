import { createServerFn } from '@tanstack/react-start'

type FirstRun = { open: false } | { open: true; code: 'none' | 'required' | 'unset' }

/**
 * Whether this app of one organization still waits for its first owner, and while it does,
 * whether first-run asks the setup code: the provider's own state, read in process. With
 * many organizations nobody waits: each sign-up founds one.
 */
export const firstRun = createServerFn({ method: 'GET' }).handler(async (): Promise<FirstRun> => {
  // Imported inside the server half so no page ships the provider to the browser.
  const [{ asas }, { organizations }] = await Promise.all([import('asas'), import('asas/organizations')])
  if (organizations === 'many') return { open: false }
  type Provider = { name: string; server: { api: { firstRunState(): Promise<FirstRun> } } }
  return (asas.auth.strategies as unknown as Provider[]).find((one) => one.name === 'user')!.server.api.firstRunState()
})
