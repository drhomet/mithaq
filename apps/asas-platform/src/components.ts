import type { Language } from 'asas'
import type { ComponentsOf } from 'mithaq-admin/components.tsx'
import { defaultComponents } from 'mithaq-admin/default-components.tsx'
import { richTextComponents } from 'mithaq-admin/rich-text.tsx'
import { uploadComponents } from 'mithaq-admin/upload.tsx'

// Typed against the language, so a kind of the project's own with no control or cell here is a type error, and so
// is leaving out the rich text or files add-on while the language holds its kind.
// Spread defaultComponents.controls or defaultComponents.cells to add or replace one.
// A file of its own, so the server entry reads the map without evaluating the router and its route tree.
export const components: ComponentsOf<Language> = {
  ...defaultComponents,
  controls: { ...defaultComponents.controls, ...richTextComponents.controls, ...uploadComponents.controls },
  cells: { ...defaultComponents.cells, ...richTextComponents.cells, ...uploadComponents.cells },
}
