import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const lint = (...files: string[]) =>
  spawnSync(process.execPath, [fileURLToPath(new URL('./lint-args.ts', import.meta.url)), ...files], { encoding: 'utf8' })

test('an exported function, class member, function type, function typed in a parameter or function in an export list with three positional parameters fails, and nothing else in the fixture does', () => {
  const run = lint(fileURLToPath(new URL('./lint-args.fixture.ts', import.meta.url)))
  assert.equal(run.status, 1)
  const named = run.stdout.trim().split('\n').map((line) => line.split(' ')[1])
  assert.deepEqual(named, [
    'threePositional',
    'arrowOfThree',
    'CallbackOfThree',
    'AdapterWithThree.insert',
    'ClassOfThree.constructor',
    'ClassOfThree.method',
    'takesCallbackOfThree.read',
    'listedOfThree',
    'default.constructor',
  ])
})
