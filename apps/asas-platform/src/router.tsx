import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { flatSearch } from './screen-list.tsx'
import type { Language } from 'asas'
import { ComponentsProvider, type ComponentsOf } from './components/mithaq/components.tsx'
import { defaultComponents } from './components/mithaq/default-components.tsx'

// Typed against the language, so a kind of the project's own with no control here is a type error. Spread
// defaultComponents.controls to add or replace one.
const components: ComponentsOf<Language> = defaultComponents

// routeTree.gen.ts is committed: a clean checkout has to typecheck before any build.
// The search stays the URL's own pairs, one string each; a screen's list keeps its `qs` URL there.
export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
    ...flatSearch,
    // Around every route, so each screen draws its controls from this map.
    Wrap: ({ children }) => <ComponentsProvider components={components}>{children}</ComponentsProvider>,
  })
