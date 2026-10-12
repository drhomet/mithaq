import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { flatSearch } from './screen-list.tsx'

// routeTree.gen.ts is committed: a clean checkout has to typecheck before any build.
// The search stays the URL's own pairs, one string each; a screen's list keeps its `qs` URL there.
export const getRouter = () => createRouter({ routeTree, scrollRestoration: true, ...flatSearch })
