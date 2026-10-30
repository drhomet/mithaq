import './dom.ts'
import './tsx.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AutoLinkNode } from '@lexical/link'
import { defaultNodes, richTextFeatures, typesOf, UploadNode, versionsOf } from 'mithaq/rich-text'
import { defaultNodeRegistry } from 'mithaq/rich-text/registry'

const { viewsOf } = await import('../registry/rich-text-picks.tsx')
const { loadRichTextFeatures, useFeatureNodes } = await import('../registry/rich-text-features.tsx')

test('the browser feature lists and React views keep the registry types and JSON versions', async () => {
  const modules = await loadRichTextFeatures({ features: richTextFeatures, fonts: ['sans'], comments: { threads: 'threads' } }, { mentions: () => import('../registry/rich-text-mentions.tsx'), comments: () => import('../registry/rich-text-comments.tsx') })
  const base = viewsOf([...defaultNodes, AutoLinkNode, UploadNode])
  function Inventory() {
    const selected = useFeatureNodes({ nodes: base, modules })
    assert.deepEqual([...typesOf(selected)].sort(), defaultNodeRegistry.map((node) => node.type).sort())
    const versions = versionsOf(selected)
    for (const node of defaultNodeRegistry) assert.equal(versions.get(node.type), node.json.writes, node.type)
    return null
  }
  renderToStaticMarkup(createElement(Inventory))
})
