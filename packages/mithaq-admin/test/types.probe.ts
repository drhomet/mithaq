import { useKayanField, useValues } from '../registry/form.tsx'

type CoursesValues = { currency: 'SAR' | 'USD'; fee: number }

const field = () => {
  const currency = useKayanField<CoursesValues, 'currency'>('currency').value
  const narrowed: 'SAR' | 'USD' = currency
  const fee: number = useValues<CoursesValues>().fee
  // @ts-expect-error this kayan declares no curency field
  useKayanField<CoursesValues, 'curency'>('curency')
  return [narrowed, fee]
}
void field

import type { ReactNode } from 'react'
import {
  type ButtonProps,
  type CellProps,
  type ComponentProps,
  type ControlProps,
  type EmptyProps,
  type LayoutProps,
  type MenuProps,
  type PageProps,
  type ProviderProps,
  type ShellProps,
  type Translate,
} from 'mithaq/admin'
import {
  useAccess,
  useClient,
  useForm,
  useKayan,
  useLocale,
  useNav,
  useRecord,
  useScreen,
  useUser,
} from 'mithaq/admin/react'
import type { NodeMap, Places } from '../registry/nodes.tsx'
import type { Components } from '../registry/components.tsx'

export const probes: { [Place in keyof Places]: Places[Place] } = {
  provider: ({ children }: ProviderProps<ReactNode>) => children,
  shell: ({ regions }: ShellProps<readonly ['main'], ReactNode>) => [useNav().length, useScreen().path, regions.main],
  page: (_: PageProps) => useUser().name,
  layout: ({ regions, page }: LayoutProps<readonly ['main'], ReactNode>) => [page.path, useRecord()?.id as string, regions.main],
  component: (_: ComponentProps) => (useForm().setValue('title', useKayan().name), useForm().getData().title as string),
  control: ({ field, issue, onChange }: ControlProps) => (onChange(field.name), issue),
  cell: ({ row, value }: CellProps) => String(value ?? row.id ?? useLocale().t('x')),
  empty: ({ page }: EmptyProps) => `${useKayan().name}${page.path}${Object.keys(useAccess()).length}`,
  menu: ({ row, open }: MenuProps<ReactNode>) => (open(null), String(row.id ?? useLocale().t('x'))),
  button: ({ operation, run, busy }: ButtonProps) => (busy ? null : (void run({}), void useClient(), operation)),
}
// @ts-expect-error a control is handed no `form` prop
export const formless: Places['control'] = ({ form }: ControlProps & { form: string }) => form
// @ts-expect-error a cell is handed the row it sits in, never a setter
export const setterless: Places['cell'] = ({ setValue }: CellProps & { setValue: () => void }) => String(setValue)

// @ts-expect-error a shell reads its copy through `useLocale()`
export const shellCopy: Places['shell'] = ({ t }: ShellProps<readonly ['main'], ReactNode> & { t: Translate }) => t('x')
// @ts-expect-error a page of the screen's own reads its user through `useUser()`
export const pageUser: Places['page'] = ({ user }: PageProps & { user: { name: string } }) => user.name
// @ts-expect-error a layout reads the screen through `useScreen()`
export const layoutScreen: Places['layout'] = ({ screen }: LayoutProps<readonly ['main'], ReactNode> & { screen: { path: string } }) => screen.path
// @ts-expect-error a component reads the form's values through `useForm()`
export const componentValues: Places['component'] = ({ values }: ComponentProps & { values: Record<string, unknown> }) => String(values.title)
// @ts-expect-error a control reads its kayan through `useKayan()`
export const controlKayan: Places['control'] = ({ kayan }: ControlProps & { kayan: { name: string } }) => kayan.name
// @ts-expect-error a cell reads the access report through `useAccess()`
export const cellAccess: Places['cell'] = ({ access }: CellProps & { access: object }) => String(access)
// @ts-expect-error an empty list reads its locale through `useLocale()`
export const emptyLocale: Places['empty'] = ({ locale }: EmptyProps & { locale: string }) => locale
// @ts-expect-error a button reads the row through `useRecord()`
export const buttonRecord: Places['button'] = ({ record }: ButtonProps & { record: { id: string } }) => record.id

declare const kinds: NodeMap
const { separator: _separator, ...withoutSeparator } = kinds
// @ts-expect-error the separator kind has no entry
export const partial: NodeMap = withoutSeparator

declare const components: Components
export const replaced: Components = { ...components, controls: { ...components.controls, text: components.controls.textarea } }
export const unknownName: Components = {
  ...components,
  // @ts-expect-error no control the registry ships is named color, so no screen could ask for it
  controls: { ...components.controls, color: components.controls.text },
}
export const wrongSignature: Components = {
  ...components,
  // @ts-expect-error a control is handed ControlProps, whose value is unknown, not a number
  controls: { ...components.controls, number: ({ value }: { value: number }) => value.toFixed() },
}
const { text: _text, ...textless } = components.controls
// @ts-expect-error a map that leaves a kind out is refused
export const missing: Components = { controls: textless }
