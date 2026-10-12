// Written by `mithaq generate screens`. Do not edit.
import { createFileRoute } from '@tanstack/react-router'
import { ScreenPageView, askedFor, pageHead, pageLoader } from '@/screens.tsx'
import { files } from './dashboard/files.ts'

export const Route = createFileRoute('/(screens)/dashboard/')({
  loader: ({ location }) => pageLoader({ screen: 'dashboard', files, path: '', query: {}, href: location.href }),
  head: ({ loaderData, match }) => pageHead(loaderData, match.context),
  component: () => <ScreenPageView files={files} data={Route.useLoaderData()} query={askedFor({})} onQuery={() => {}} />,
})
