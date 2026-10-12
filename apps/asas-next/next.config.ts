import type { NextConfig } from 'next'

export default {
  // The root `tsc -p tsconfig.json` already checks this app and is the only authoritative
  // check; the tsconfig.json Next writes here is weaker.
  typescript: { ignoreBuildErrors: true },
} satisfies NextConfig
