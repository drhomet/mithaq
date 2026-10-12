// Written by `mithaq generate screens`. Do not edit.
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { ScreenFrame, frameLoader } from '@/screens.tsx'
import { files } from './dashboard/files.ts'

export const Route = createFileRoute('/(screens)/dashboard')({
  loader: ({ location }) => frameLoader({ screen: 'dashboard', files, href: location.href }),
  component: () => (
    <ScreenFrame files={files} data={Route.useLoaderData()}>
      <Outlet />
    </ScreenFrame>
  ),
})
