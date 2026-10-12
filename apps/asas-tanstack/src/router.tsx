import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { flatSearch } from './screen-list.tsx'

// The search is read and written as the URL's own pairs, one string each, because a list
// keeps its `qs` query there.
export const getRouter = () => createRouter({ routeTree, scrollRestoration: true, ...flatSearch })
