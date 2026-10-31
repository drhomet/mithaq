import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { SEED, paragraphsArb, rawEditArb, resolveEdit, runsFromParagraphs } from './__fixtures__/gen.ts'
import { fromRuns, modelApply, toRuns } from './__fixtures__/model.ts'
import { createRunsEditor, nodesToPlainText, nodesToRuns, runsToNodes } from './codec.ts'
import { applyEdit } from './edit.ts'
import { plainText, validateRuns, type Runs } from './runs.ts'

// Sequences of 1 to 20 edits, so a failure shrinks to the few edits that matter; 200 runs pass the 1,000 edits the spike asks for.
const MAX_EDITS = 20
const RUNS = 200

test('1,000 random edits keep runs → nodes → runs the identity, and applyEdit agrees with an independent model', (t) => {
  let edits = 0
  let refused = 0
  fc.assert(
    fc.property(paragraphsArb, fc.array(rawEditArb, { minLength: 1, maxLength: MAX_EDITS }), (rows, raws) => {
      const editor = createRunsEditor()
      let runs: Runs = validateRuns(runsFromParagraphs(rows))
      for (const raw of raws) {
        const edit = resolveEdit(runs, raw)
        const before = structuredClone(runs)
        const result = applyEdit(runs, edit)
        const expected = modelApply(fromRuns(runs), edit)
        assert.equal(result.ok, expected !== null, JSON.stringify(edit))
        assert.deepEqual(runs, before)
        if (!result.ok) { refused++; continue }
        edits++
        assert.deepEqual(result.runs, toRuns(expected!))
        runs = validateRuns(result.runs)
        runsToNodes(editor, runs)
        assert.deepEqual(nodesToRuns(editor), runs)
        // With no locked unit, the only U+FFFC are dividers, which read as nothing.
        assert.equal(plainText(runs), runs.text.replaceAll('￼', ''))
        assert.equal(nodesToPlainText(editor), plainText(runs), 'plain text from the nodes matches the runs')
        assert.doesNotMatch(plainText(runs), /[•◦▪‣￼]/)
      }
    }),
    { seed: SEED, numRuns: RUNS },
  )
  t.diagnostic(`seed ${SEED}: ${RUNS} sequences, ${edits} edits applied, ${refused} refused`)
  assert.ok(edits >= 1000, `${edits} edits`)
})
