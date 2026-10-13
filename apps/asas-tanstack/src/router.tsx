import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { flatSearch } from './screen-list.tsx'
import type { Language } from 'asas'
import { ComponentsProvider, RouteError, type ComponentsOf } from './components/mithaq/components.tsx'
import { defaultComponents } from './components/mithaq/default-components.tsx'
import { richTextComponents } from './components/mithaq/rich-text.tsx'
import { uploadComponents } from './components/mithaq/upload.tsx'

// Typed against the language, so a kind of the project's own with no control or cell here is a type error, and so
// is leaving out the rich text or files add-on while the language holds its kind.
// Spread defaultComponents.controls or defaultComponents.cells to add or replace one.
export const components: ComponentsOf<Language> = {
  ...defaultComponents,
  controls: { ...defaultComponents.controls, ...richTextComponents.controls, ...uploadComponents.controls },
  cells: { ...defaultComponents.cells, ...richTextComponents.cells, ...uploadComponents.cells },
}

// The search is read and written as the URL's own pairs, one string each, because a list
// keeps its `qs` query there.
export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
    ...flatSearch,
    // Around every route, so each screen draws its controls from this map.
    Wrap: ({ children }) => <ComponentsProvider components={components}>{children}</ComponentsProvider>,
    // Drawn in place of the route that threw, so the shell around it stays.
    defaultErrorComponent: RouteError,
  })
