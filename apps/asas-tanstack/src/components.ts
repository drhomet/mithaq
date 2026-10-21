import type { Language } from 'asas'
import { navIcons } from 'asas/ui-dashboard/nav-icons.ts'
import type { ComponentsOf } from 'mithaq-admin/components.tsx'
import { defaultComponents } from 'mithaq-admin/default-components.tsx'
// add-on: rich-text
import { richTextComponents } from 'mithaq-admin/rich-text.tsx'
// end add-on: rich-text
// add-on: uploads
import { uploadComponents } from 'mithaq-admin/upload.tsx'
// end add-on: uploads

// Typed against the language, so a kind of the project's own with no control or cell here is a type error, and so
// is leaving out the rich text or files add-on while the language holds its kind.
// Spread defaultComponents.controls or defaultComponents.cells to add or replace one.
// A file of its own, so the server entry reads the map without evaluating the router and its route tree.
export const components: ComponentsOf<Language> = {
  ...defaultComponents,
  icons: navIcons,
  controls: {
    ...defaultComponents.controls,
    // add-on: rich-text
    ...richTextComponents.controls,
    // end add-on: rich-text
    // add-on: uploads
    ...uploadComponents.controls,
    // end add-on: uploads
  },
  cells: {
    ...defaultComponents.cells,
    // add-on: rich-text
    ...richTextComponents.cells,
    // end add-on: rich-text
    // add-on: uploads
    ...uploadComponents.cells,
    // end add-on: uploads
  },
}
