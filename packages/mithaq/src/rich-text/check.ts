#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { checkRichTextSupport } from './registry.ts'

const main = async () => {
  try {
    const { values } = parseArgs({ options: { profile: { type: 'string' }, registry: { type: 'string' }, strict: { type: 'boolean' } }, allowPositionals: false })
    if (!values.profile || !values.registry) throw new Error('Bad CLI use')
    const profile = (await import(pathToFileURL(resolve(values.profile)).href)).default
    const registry = (await import(pathToFileURL(resolve(values.registry)).href)).default
    const diagnostics = checkRichTextSupport({ profile, registry })
    for (const diagnostic of diagnostics) console.log(JSON.stringify(diagnostic))
    return diagnostics.some((item) => item.severity === 'error' || values.strict) ? 1 : 0
  } catch {
    console.error(JSON.stringify({ severity: 'error', code: 'invalid-input', remedy: 'Pass readable modules with --profile and --registry.' }))
    return 1
  }
}
process.exitCode = await main()
