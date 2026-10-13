import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { flatSearch } from './screen-list.tsx'
import { ComponentsProvider, RouteError } from 'mithaq-admin/components.tsx'
import { components } from './components.ts'

// routeTree.gen.ts is committed: a clean checkout has to typecheck before any build.
// The search stays the URL's own pairs, one string each; a screen's list keeps its `qs` URL there.
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
