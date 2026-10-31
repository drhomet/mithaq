import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { block, inline, jsonOf, type Json } from './__fixtures__/fixtures.ts'
import { SEED, paragraphsArb, rawEditArb, resolveEdit, runsFromParagraphs, type RawEdit } from './__fixtures__/gen.ts'
import { fromRuns, modelApply, toRuns } from './__fixtures__/model.ts'
import { LockedTable, loadBlock, saveBlock } from './block.ts'
import { createRunsEditor, nodesToPlainText, nodesToRuns, runsToNodes } from './codec.ts'
import { applyEdit } from './edit.ts'
import { plainText, validateRuns, type Runs } from './runs.ts'

const INLINE = Object.keys(inline) as (keyof typeof inline)[]
const BLOCK = Object.keys(block)

// Editable paragraphs from the codec, then units spliced in: paragraph units between top-level
// nodes, inline units between the children of a paragraph, heading, quote or list item, never inside a rule.
const specArb = fc.record({
  rows: paragraphsArb,
  units: fc.array(
    fc.record({ at: fc.double({ min: 0, max: 1, noNaN: true }), name: fc.constantFrom(...INLINE, ...BLOCK), inside: fc.double({ min: 0, max: 1, noNaN: true }) }),
    { maxLength: 6 },
  ),
})

const hosts = (nodes: Json[]): Json[] =>
  nodes.flatMap((n) => (n.type === 'list' ? (n.children as Json[]) : ['paragraph', 'heading', 'quote'].includes(n.type) ? [n] : []))

type Spec = { rows: Parameters<typeof runsFromParagraphs>[0]; units: { at: number; name: string; inside: number }[] }

const buildBlock = (spec: Spec): Json[] => {
  const children = jsonOf(runsFromParagraphs(spec.rows))
  for (const { at, name, inside } of spec.units) {
    if (name in block) {
      children.splice(Math.floor(at * (children.length + 1)), 0, structuredClone(block[name]!))
    } else {
      const host = hosts(children)
      if (!host.length) continue
      const target = host[Math.min(host.length - 1, Math.floor(at * host.length))]!
      const kids = target.children as Json[]
      kids.splice(Math.floor(inside * (kids.length + 1)), 0, structuredClone(inline[name as keyof typeof inline]) as unknown as Json)
    }
  }
  return children
}

// Every subtree in `saved` that equals the next payload in order, found without looking at the table.
const found = (saved: Json[], payloads: Json[]): Json[] => {
  const hits: Json[] = []
  const walk = (node: Json) => {
    if (hits.length < payloads.length && JSON.stringify(node) === JSON.stringify(payloads[hits.length])) return void hits.push(node)
    ;(node.children as Json[] | undefined)?.forEach(walk)
  }
  saved.forEach(walk)
  return hits
}

type Tally = { edits: number; refused: number; units: number; undos: number }

/** One open → edit → save session; every property is checked after each edit. */
const session = ({ children, raws, tally }: { children: Json[]; raws: RawEdit[]; tally: Tally }): Json[] => {
  const editor = createRunsEditor()
  const table = new LockedTable()
  let runs = validateRuns(loadBlock({ editor, children, table }))
  const ids = runs.locked.map((u) => u.id)
  const payloads = ids.map((id) => structuredClone(table.units.get(id)!))
  tally.units += ids.length
  assert.deepEqual(saveBlock(editor, table), children, 'opening changes nothing')
  let saved: Json[] = children
  const history: { runs: Runs; saved: Json[] }[] = [{ runs, saved: children }]
  for (const raw of raws) {
    const edit = resolveEdit(runs, raw)
    const before = structuredClone(runs)
    const result = applyEdit(runs, edit)
    const expected = modelApply(fromRuns(runs), edit)
    assert.equal(result.ok, expected !== null, JSON.stringify(edit))
    assert.deepEqual(runs, before, 'applyEdit never mutates its input')
    if (!result.ok) {
      tally.refused++
      assert.equal(result.reason, 'locked-content')
      // A refused edit changes nothing: the nodes still save to the document they saved to before.
      assert.deepEqual(saveBlock(editor, table), saved)
      continue
    }
    tally.edits++
    assert.deepEqual(result.runs, toRuns(expected!), 'editable changes match the independent model')
    runs = validateRuns(result.runs, ids)
    runsToNodes(editor, runs)
    assert.deepEqual(nodesToRuns(editor), runs)
    assert.deepEqual([...table.units.values()], payloads, 'payloads unchanged')
    saved = saveBlock(editor, table)
    history.push({ runs, saved })
    // The originals may hold anything, U+FFFC included; the rest of the document must not.
    const text = payloads.reduce((rest, payload) => rest.replace(JSON.stringify(payload), ''), JSON.stringify(saved))
    assert.ok(!text.includes('locked-unit'))
    assert.ok(!text.includes('\uFFFC'))
    assert.deepEqual(found(saved, payloads), payloads, 'the exported JSON holds the original subtrees, in order')
    const words = nodesToPlainText(editor)
    assert.equal(words, plainText(runs))
    assert.ok(!words.includes('\uFFFC'))
    assert.doesNotMatch(words, /[•◦▪‣]/)
    for (const unit of runs.locked) assert.ok(words.includes(unit.preview))
  }
  // Undo to any earlier state can never remove a unit that was there at load.
  for (const snapshot of history.slice(0, -1).reverse()) {
    runsToNodes(editor, validateRuns(snapshot.runs, ids))
    assert.deepEqual(nodesToRuns(editor), snapshot.runs, 'undo restores the earlier runs')
    const restored = saveBlock(editor, table)
    assert.deepEqual(restored, snapshot.saved, 'undo saves the earlier document')
    assert.deepEqual(found(restored, payloads), payloads, 'undo preserves every locked subtree in order')
    assert.deepEqual([...table.units.values()], payloads, 'undo leaves payloads untouched')
    assert.equal(nodesToPlainText(editor), plainText(snapshot.runs))
    tally.undos++
  }
  return saved
}

test('1,000 random edits around locked units: refused where they must be, identical elsewhere, across save and reload', (t) => {
  const tally: Tally = { edits: 0, refused: 0, units: 0, undos: 0 }
  fc.assert(
    fc.property(fc.tuple(specArb, fc.array(rawEditArb, { minLength: 1, maxLength: 15 }), fc.array(rawEditArb, { minLength: 1, maxLength: 15 })), ([spec, first, second]) => {
      const original = buildBlock(spec)
      const saved = session({ children: original, raws: first, tally })
      // Reload the saved document in a new session (new editor, new ids) and edit again.
      const again = session({ children: saved, raws: second, tally })
      const table = new LockedTable()
      const payloads = [...(() => { const e = createRunsEditor(); loadBlock({ editor: e, children: original, table }); return table.units.values() })()]
      assert.deepEqual(found(again, payloads), payloads, 'the same subtrees after save, reload and edit')
    }),
    { seed: SEED, numRuns: 200 },
  )
  t.diagnostic(`seed ${SEED}: 200 documents, ${tally.edits} edits applied, ${tally.refused} refused, ${tally.units} units opened, ${tally.undos} undo snapshots restored`)
  assert.ok(tally.edits >= 1000, `${tally.edits} edits`)
  assert.ok(tally.refused > 100, `${tally.refused} refused`)
  assert.ok(tally.undos >= 1000, `${tally.undos} undos`)
})
