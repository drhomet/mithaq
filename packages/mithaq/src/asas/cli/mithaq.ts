#!/usr/bin/env node
// Each generator is imported when its word is asked for, so `better-auth/db` loads
// only for `generate auth` and the `generate --check` sweep.
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { Command } from '../../mithaq/language.ts'
import { Refusal } from '../../mithaq/refusal.ts'
import type { ScreenClient } from '../../screen/index.ts'

const verbs = ['eject', 'generate', 'lock', 'migrate', 'screens', 'upgrade']
const nouns = ['auth', 'messages', 'screens']
const usage =
  'Usage: mithaq generate auth [--check] | mithaq generate messages [--check] [--no-data-scan] | mithaq generate screens [--check] | mithaq generate --check | mithaq lock [--check] | mithaq migrate [--check] [--name <slug>] | mithaq screens | mithaq upgrade --check | mithaq eject <item> | mithaq eject --prune | mithaq <target> <command> [--check]'

type Built = {
  targets: Record<string, { commands?: Record<string, Command> } | undefined>
  destroy(): Promise<void>
}

// Run as a command, not imported. The bin is a symlink, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  try {
    const [, , verb, noun, ...rest] = process.argv
    // Before anything reads the project: outside one there is no `src/asas.ts` to import.
    if (verb === '--help' || verb === '-h') {
      console.log(usage)
      process.exit(0)
    }
    // `generate --check` takes no noun, so the word in the noun's place is a flag.
    const flags = noun?.startsWith('--') ? [noun, ...rest] : rest
    const sweeping = verb === 'generate' && flags.includes('--check') && !nouns.includes(noun ?? '')
    // `migrate` is a word of the bin's own wherever it stands first, so it takes flags
    // and never a second word; a target named `migrate` is reached by no spelling.
    const misplaced = (verb === 'migrate' || verb === 'upgrade') && noun !== undefined && !noun.startsWith('--')
    const unchecked = verb === 'upgrade' && !flags.includes('--check')
    // `eject` takes one item or `--prune`, never both and never neither.
    const ejecting = noun !== undefined && !noun.startsWith('--')
    const unejected = verb === 'eject' && (ejecting ? flags.length > 0 : flags.join(' ') !== '--prune')
    if (verb === undefined || misplaced || unchecked || unejected || (verb === 'generate' && !(sweeping || nouns.includes(noun ?? '')))) {
      console.error(usage)
      process.exit(1)
    }
    const project = pathToFileURL(`${process.cwd()}/`)
    const check = flags.includes('--check')
    // The project saying it has no database to scan, which a check otherwise refuses to pass without.
    const scan = !flags.includes('--no-data-scan')
    const auth = async (checking: boolean) => (await import('../../auth/better-auth/generate.ts')).run(project, checking)
    const messages = async () => (await import('../../mithaq/generate-messages.ts')).run({ project, check, dataScan: scan })
    const screens = async () => (await import('../../screen/generate.ts')).run(project, check)
    const upgrade = async () => (await import('./upgrade.ts')).run(project)
    const lock = async (word: string | undefined, words: readonly string[]) => (await import('../../mithaq/lock.ts')).run({ project, noun: word, flags: words })
    // Imported only where a target's command was asked for: `generate auth` runs against
    // a project whose `src/asas.ts` may not import at all.
    const asasOf = async () => ((await import(new URL('src/asas.ts', project).href)) as { asas: Built }).asas
    // `Object.hasOwn`: a typed word would otherwise reach `Object.prototype`, and
    // `mithaq drizzle constructor` would call `Object`.
    const commandsOf = (asas: Built, name: string) =>
      (Object.hasOwn(asas.targets, name) ? asas.targets[name]?.commands : undefined) ?? {}
    const commandIn = (commands: Record<string, Command>, name: string) =>
      Object.hasOwn(commands, name) ? commands[name] : undefined
    const everyCommand = (asas: Built) =>
      Object.entries(asas.targets).flatMap(([name, target]) =>
        Object.entries(target?.commands ?? {}).map(([command, one]) => [`${name} ${command}`, one] as const),
      )
    const stopped = (name: string, code: number): never => {
      console.error(`\`mithaq ${name} --check\` answered ${code}, so the sweep stopped there.`)
      process.exit(code)
    }
    // Every command but the lock's own and the sweep shows an unsigned language change first.
    if (verb !== 'lock' && !(verb === 'generate' && sweeping)) await (await import('../../mithaq/lock.ts')).warnLock(project)
    if (verb === 'generate' && sweeping) {
      // Stops at the first non-zero, so a pipeline reads which check failed. The lock goes first,
      // and `migrate` before anything that reads rows, so an unmigrated database stops it by name.
      const step = async (name: string, one: () => Promise<number>) => {
        const code = await one()
        if (code) stopped(name, code)
      }
      await step('lock', () => lock(undefined, ['--check']))
      await step('generate auth', () => auth(true))
      // A command with no check to make answers 0 for the flag it does not know.
      const asas = await asasOf()
      const commands = everyCommand(asas)
      const migrates = commands.filter(([name]) => name.endsWith(' migrate'))
      const others = commands.filter(([name]) => !name.endsWith(' migrate'))
      for (const [name, one] of migrates) await step(name, () => one({ asas, flags }))
      await step('generate messages', messages)
      await step('generate screens', screens)
      for (const [name, one] of others) await step(name, () => one({ asas, flags }))
      // A report, never a gate: a copy that differs from the registry is a file the project owns.
      await upgrade().catch((error: Error) => console.error(`upgrade --check could not read the copies: ${error.message}`))
    } else if (verb === 'lock') {
      const code = await lock(noun?.startsWith('--') ? undefined : noun, flags)
      if (code) process.exit(code)
    } else if (verb === 'eject') {
      const { eject, prune } = await import('./upgrade.ts')
      const code = ejecting ? await eject(project, noun!) : await prune(project)
      if (code) process.exit(code)
    } else if (verb === 'upgrade') {
      const code = await upgrade()
      if (code) process.exit(code)
    } else if (verb === 'generate') {
      const code = await (noun === 'messages' ? messages() : noun === 'screens' ? screens() : auth(check))
      if (code) process.exit(code)
    } else if (verb === 'screens') {
      const { studioText, studioTree } = await import('../../screen/studio.ts')
      const targets = (await asasOf()).targets as Record<string, { capability?: unknown; client?: ScreenClient } | undefined>
      const trees = Object.entries(targets).flatMap(([name, target]) => (target?.capability === 'screen' ? [studioText(studioTree(name, target.client!))] : []))
      console.log(trees.join('\n\n'))
    } else {
      const asas = await asasOf()
      // Two stores that both declare `migrate` cannot be told apart by the bare word, so it is refused.
      const aliased = verb === 'migrate'
      const declared = aliased ? Object.keys(asas.targets).filter((name) => commandsOf(asas, name).migrate) : []
      if (aliased && declared.length === 0) {
        throw new Refusal(
          'No target of this language declares a `migrate` command, and that is what `mithaq migrate` runs. Name a store that declares one in `targets`, or migrate that store with its own tool.',
        )
      }
      if (aliased && declared.length > 1) {
        throw new Refusal(
          `${declared.join(', ')} each declare a \`migrate\` command, so \`mithaq migrate\` cannot say which one to run. Name the target: ${declared.map((name) => `\`mithaq ${name} migrate\``).join(', ')}.`,
        )
      }
      const target = aliased ? declared[0]! : verb
      const command = aliased ? 'migrate' : noun
      if (!Object.hasOwn(asas.targets, target)) {
        throw new Refusal(
          `"${verb}" is neither a command of mithaq nor a target of this language. The commands are ${verbs.join(' and ')}; the targets are ${Object.keys(asas.targets).join(', ')}.`,
        )
      }
      if (command === undefined || command.startsWith('--')) {
        console.error(usage)
        process.exit(1)
      }
      const one = commandIn(commandsOf(asas, target), command)
      if (!one) {
        const has = Object.keys(commandsOf(asas, target)).map((name) => `\`${name}\``)
        throw new Refusal(
          `Target "${target}" declares no \`${command}\` command. It declares ${has.length ? has.join(', ') : 'none at all'}.`,
        )
      }
      const code = await one({ asas, flags })
      if (code) process.exit(code)
    }
  } catch (error) {
    // Anything that is not a refusal is rethrown, so Node prints its stack, which is the whole
    // diagnosis of a project's `src/asas.ts` failing to import.
    if (!(error instanceof Refusal)) throw error
    console.error(error.message)
    process.exit(1)
  }
}
