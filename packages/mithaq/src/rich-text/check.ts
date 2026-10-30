#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { checkRichTextSupport, defaultNodeRegistry, richTextPlaces, type RichTextContract, type RichTextProfile } from './registry.ts'
import { checkRichTextPolicy, type RichTextPolicy } from './policy.ts'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const names = (value: unknown): value is string[] => Array.isArray(value) && value.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 255) && new Set(value).size === value.length
const support = (value: unknown) => value === 'edit' || value === 'view'
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key))

const validProfile = (value: unknown): value is RichTextProfile => {
  if (!object(value) || !keys(value, ['name', 'nodes', 'requirements']) || !names([value.name]) || !names(value.nodes) || !object(value.requirements)) return false
  return Object.entries(value.requirements).every(([place, requirement]) =>
    richTextPlaces.includes(place as typeof richTextPlaces[number]) && object(requirement) &&
    keys(requirement, ['default', 'nodes']) && support(requirement.default) &&
    (requirement.nodes === undefined || (object(requirement.nodes) && names(Object.keys(requirement.nodes)) && Object.values(requirement.nodes).every(support))))
}
const validContract = (value: unknown): value is RichTextContract => object(value) && object(value.formats) && Object.values(value.formats).every(version) && names(value.paragraphs)
const validPolicies = (value: unknown): value is readonly RichTextPolicy[] => Array.isArray(value) && value.every((policy) => {
  if (!object(policy)) return false
  checkRichTextPolicy(policy as RichTextPolicy)
  return true
})

const usage = 'mithaq-check-rich-text --profile <module> [--policies <module>] [--contract <contract.json>] [--strict] [--json]'
const readModule = async (path: string): Promise<unknown> => (await import(pathToFileURL(resolve(path)).href)).default

const main = async () => {
  let code = 'invalid-cli'
  try {
    const { values } = parseArgs({ options: { profile: { type: 'string' }, policies: { type: 'string' }, contract: { type: 'string' }, strict: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean' } }, allowPositionals: false })
    if (values.help) { console.log(usage); return 0 }
    if (!values.profile || Object.entries(values).some(([, value]) => value === '')) throw new Error()
    code = 'unreadable-input'
    const profile = await readModule(values.profile)
    const policies = values.policies ? await readModule(values.policies) : []
    const contract: unknown = values.contract ? JSON.parse(readFileSync(resolve(values.contract), 'utf8')) : undefined
    code = 'invalid-input'
    if (!validProfile(profile) || !validPolicies(policies) || (contract !== undefined && !validContract(contract))) throw new Error()
    const diagnostics = checkRichTextSupport({ profile, registry: defaultNodeRegistry, policies, contract })
    if (values.json) for (const diagnostic of diagnostics) console.log(JSON.stringify(diagnostic))
    // One gap usually spans many nodes, so a person reads one line per gap rather than one per node.
    else for (const [key, items] of Map.groupBy(diagnostics, (item) => `${item.severity} ${item.code} at ${item.place ?? 'every place'}`)) {
      console.log(`${key} (${items.length}): ${items.map((item) => item.feature ? `${item.feature} on ${item.node}` : item.node).join(', ')}. ${items[0]!.remedy}`)
    }
    return diagnostics.some((item) => item.severity === 'error' || values.strict) ? 1 : 0
  } catch {
    // Module errors can contain document data or credentials; only configuration advice crosses the CLI boundary.
    console.error(JSON.stringify({ severity: 'error', code, remedy: `Pass readable inputs with valid declared shapes. Usage: ${usage}` }))
    return 1
  }
}
process.exitCode = await main()
