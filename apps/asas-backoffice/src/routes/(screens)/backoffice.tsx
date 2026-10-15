// Written by `mithaq generate screens`. Do not edit.
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { ScreenFrame, frameLoader } from '@/screens.tsx'
import { files } from './backoffice/files.ts'

export const Route = createFileRoute('/(screens)/backoffice')({
  loader: ({ location }) => frameLoader({ screen: 'backoffice', files, href: location.href }),
  component: () => (
    <ScreenFrame files={files} data={Route.useLoaderData()}>
      <Outlet />
    </ScreenFrame>
  ),
})
