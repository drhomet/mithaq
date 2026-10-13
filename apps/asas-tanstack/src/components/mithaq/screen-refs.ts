import type { ComponentType, ReactNode } from 'react'
import type {
  ButtonProps,
  CellProps,
  ClientKayan,
  ComponentProps,
  ControlProps,
  EmptyProps,
  FrameClient,
  LayoutProps,
  MenuProps,
  PageClient,
  PageProps,
  ProviderProps,
  ShellProps,
} from 'mithaq/admin'

/**
 * What each place a screen names a component hands it, from `mithaq/admin`, with a React node where
 * the props carry one. Everything else a component reads through the hooks `mithaq/admin/react`
 * exports.
 */
export type Places = {
  provider: ComponentType<ProviderProps<ReactNode>>
  shell: ComponentType<ShellProps<readonly string[], ReactNode>>
  page: ComponentType<PageProps>
  layout: ComponentType<LayoutProps<readonly string[], ReactNode>>
  component: ComponentType<ComponentProps>
  control: ComponentType<ControlProps>
  cell: ComponentType<CellProps>
  empty: ComponentType<EmptyProps>
  menu: ComponentType<MenuProps<ReactNode>>
  button: ComponentType<ButtonProps>
}

/** The components a screen names by path, keyed by the path `screen.json` prints. */
export type Refs = Readonly<Record<string, ComponentType<never>>>

/** A kayan's page declared as one tree, rather than drawn whole by one component. */
export type TreePage = Extract<PageClient, { page: FrameClient }>

/** What a form or a list draws a screen's page with, beside the adapted kayan. */
export type ScreenPage = {
  refs: Refs
  /** The screen's own kayan, which is what a component named by path is handed. */
  kayan: ClientKayan
  page: TreePage
}

/** A component the page names by path, typed for the place it sits in. */
export const refOf = <Place extends keyof Places>({
  screen,
  place: _place,
  path,
}: {
  screen: Pick<ScreenPage, 'refs'> | undefined
  place: Place
  path: string | undefined
}) =>
  (screen && path && Object.hasOwn(screen.refs, path) ? screen.refs[path] : undefined) as Places[Place] | undefined
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 5917ecc796103125309a8ba0c03997a873553b5ac5ae00516496aea09a929014
