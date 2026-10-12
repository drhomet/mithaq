// Written by `mithaq generate screens`. Do not edit.
import { createFileRoute } from '@tanstack/react-router'
import { ScreenNotFound, ScreenPageView, askedFor, pageHead, pageLoader } from '@/screens.tsx'
import { files } from './portal/files.ts'

export const Route = createFileRoute('/(screens)/portal/$')({
  validateSearch: askedFor,
  loader: ({ location, params }) => pageLoader({ screen: 'portal', files, path: params._splat ?? '', query: location.search, href: location.href }),
  head: ({ loaderData, match }) => pageHead(loaderData, match.context),
  notFoundComponent: () => <ScreenNotFound files={files} screen={'portal'} />,
  component: Page,
})

function Page() {
  const navigate = Route.useNavigate()
  return <ScreenPageView files={files} data={Route.useLoaderData()} query={Route.useSearch()} onQuery={(search) => void navigate({ search })} />
}
