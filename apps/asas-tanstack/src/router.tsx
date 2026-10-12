import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { flatSearch } from './screen-list.tsx'
import { ComponentsProvider } from './components/mithaq/components.tsx'
import { defaultComponents } from './components/mithaq/default-components.tsx'

// The search is read and written as the URL's own pairs, one string each, because a list
// keeps its `qs` query there.
export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
    ...flatSearch,
    // Around every route, so each screen draws its controls from the map this app hands it; spread defaultComponents to replace one.
    Wrap: ({ children }) => <ComponentsProvider components={defaultComponents}>{children}</ComponentsProvider>,
  })
