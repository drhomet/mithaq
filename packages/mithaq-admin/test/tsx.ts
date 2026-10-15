// Node refuses `.tsx` imports: this loader transforms them and resolves the `@/` aliases registry files use, and
// reads a stylesheet as an empty module.
// `registerHooks` is synchronous, so a test installs it and then imports dynamically in the same tick.
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const aliases: Record<string, { at: string; extension: string }> = {
  '@/components/ui/': { at: '../registry/ui/', extension: '.tsx' },
  '@/hooks/': { at: '../registry/hooks/', extension: '.ts' },
  '@/lib/': { at: '../registry/lib/', extension: '.ts' },
  // Anything else under `@/` is the app's own, and carries its extension.
  '@/': { at: '../../../apps/asas-tanstack/src/', extension: '' },
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Registry primitives import siblings extensionless, which Node's loader does not resolve.
    if (specifier.startsWith('./') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.endsWith('.tsx')) {
      return { shortCircuit: true, url: new URL(`${specifier}.tsx`, context.parentURL).href }
    }
    const alias = Object.keys(aliases).find((one) => specifier.startsWith(one))
    if (!alias) return nextResolve(specifier, context)
    const { at, extension } = aliases[alias]!
    return {
      shortCircuit: true,
      url: new URL(`${at}${specifier.slice(alias.length)}${extension}`, import.meta.url).href,
    }
  },
  load(url, context, nextLoad) {
    // A stylesheet a page imports, such as a font's, is Vite's to bundle and draws nothing under a test.
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const path = fileURLToPath(url)
    return {
      format: 'module',
      shortCircuit: true,
      source: transformSync(readFileSync(path, 'utf8'), {
        loader: 'tsx',
        jsx: 'automatic',
        format: 'esm',
        sourcefile: path,
      }).code,
    }
  },
})
