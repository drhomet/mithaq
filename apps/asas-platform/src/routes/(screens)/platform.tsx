// Written by `mithaq generate screens`. Do not edit.
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { ScreenFrame, frameLoader } from '@/screens.tsx'
import { files } from './platform/files.ts'

export const Route = createFileRoute('/(screens)/platform')({
  loader: ({ location }) => frameLoader({ screen: 'platform', files, href: location.href }),
  component: () => (
    <ScreenFrame files={files} data={Route.useLoaderData()}>
      <Outlet />
    </ScreenFrame>
  ),
})
