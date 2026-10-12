// Written by `mithaq generate screens`. Do not edit.
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { ScreenFrame, frameLoader } from '@/screens.tsx'
import { files } from './portal/files.ts'

export const Route = createFileRoute('/(screens)/portal')({
  loader: ({ location }) => frameLoader({ screen: 'portal', files, href: location.href }),
  component: () => (
    <ScreenFrame files={files} data={Route.useLoaderData()}>
      <Outlet />
    </ScreenFrame>
  ),
})
