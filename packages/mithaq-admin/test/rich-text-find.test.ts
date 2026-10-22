import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEditor, $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $findMatches, $replaceMatches } from '../registry/rich-text-find.ts'

test('find and replace crosses formatting runs, handles Arabic whole words and replaces all once', () => {
  const editor = createEditor({ onError: (error) => { throw error } })
  editor.update(() => {
    $getRoot().append($createParagraphNode().append($createTextNode('مرحبا ').setFormat('bold'), $createTextNode('بكم مرحبا مرحباكم Hello HELLO')))
    const options = { query: 'مرحبا', matchCase: false, wholeWord: true, locale: 'ar' }
    assert.equal($findMatches(options).length, 2)
    assert.equal($replaceMatches({ ...options, replacement: 'أهلا', all: true, index: 0 }), 2)
    assert.equal($getRoot().getTextContent(), 'أهلا بكم أهلا مرحباكم Hello HELLO')
    assert.equal($findMatches({ ...options, query: 'hello' }).length, 2)
    assert.equal($findMatches({ ...options, query: 'Hello', matchCase: true }).length, 1)
    assert.equal($replaceMatches({ ...options, query: 'أهلا بكم', replacement: 'تم', all: false, index: 0 }), 1)
    assert.equal($getRoot().getTextContent(), 'تم أهلا مرحباكم Hello HELLO')
  }, { discrete: true })
})

test('find does not join words across a line break or loop over inserted replacement text', async () => {
  const { $createLineBreakNode } = await import('lexical')
  const editor = createEditor({ onError: (error) => { throw error } })
  editor.update(() => {
    $getRoot().append($createParagraphNode().append($createTextNode('foo'), $createLineBreakNode(), $createTextNode('bar foo')))
    const options = { query: 'foobar', matchCase: false, wholeWord: false, locale: 'en' }
    assert.equal($findMatches(options).length, 0)
    assert.equal($replaceMatches({ ...options, query: 'foo', replacement: 'foofoo', all: true, index: 0 }), 2)
    assert.equal($getRoot().getTextContent(), 'foofoo\nbar foofoo')
  }, { discrete: true })
})
