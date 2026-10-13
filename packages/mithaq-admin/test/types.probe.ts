import { useKayanField, useValues } from '../registry/form-context.tsx'

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
import type { Places } from '../registry/screen-refs.ts'
import type { Components, ComponentsOf, Nodes } from '../registry/components.tsx'
import type { NodeProps } from '../registry/node-tree.ts'
import type { Cell, Control } from '../registry/control-props.ts'

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

declare const components: Components
const { separator: _separator, ...withoutSeparator } = components.nodes
// @ts-expect-error the separator kind has no entry
export const partial: Nodes = withoutSeparator
export const replacedNode: Components = { ...components, nodes: { ...components.nodes, tabs: ({ node }: NodeProps<'tabs'>) => node.tabs.length } }
export const unknownNode: Components = {
  ...components,
  // @ts-expect-error no page can hold a kind of node mithaq/admin does not declare, so the map adds none
  nodes: { ...components.nodes, callout: components.nodes.section },
}
export const wrongNode: Components = {
  ...components,
  // @ts-expect-error a tabs node is handed its tabs, not a section's fields
  nodes: { ...components.nodes, tabs: ({ node }: NodeProps<'section'>) => node.fields.length },
}

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
export const missing: Components = { ...components, controls: textless }
export const replacedCell: Components = { ...components, cells: { ...components.cells, number: components.cells.integer } }
export const unknownCell: Components = {
  ...components,
  // @ts-expect-error no cell the registry ships is named color, so no screen could ask for it
  cells: { ...components.cells, color: components.cells.text },
}
export const wrongCell: Components = {
  ...components,
  // @ts-expect-error a cell is handed CellProps, whose value is unknown, not a number
  cells: { ...components.cells, number: ({ value }: { value: number }) => value.toFixed() },
}
const { join: _join, ...joinless } = components.cells
// @ts-expect-error a map that leaves a shipped cell out is refused
export const missingCell: Components = { ...components, cells: joinless }

type ColorLanguage = typeof import('./color-language.ts').language
declare const ColorControl: Control
declare const ColorCell: Cell
const colorCells = { ...components.cells, color: ColorCell }
export const colored: ComponentsOf<ColorLanguage> = { controls: { ...components.controls, color: ColorControl }, cells: colorCells, nodes: components.nodes }
// @ts-expect-error the map carries a node per kind as well
export const nodeless: ComponentsOf<ColorLanguage> = { controls: { ...components.controls, color: ColorControl }, cells: colorCells }
// @ts-expect-error a kind the language's own rukn brings needs a control in the map
export const colorless: ComponentsOf<ColorLanguage> = { controls: components.controls, cells: colorCells, nodes: components.nodes }
// @ts-expect-error and a cell, where it names its own
export const uncelled: ComponentsOf<ColorLanguage> = { controls: { ...components.controls, color: ColorControl }, cells: components.cells, nodes: components.nodes }
export const misspelled: ComponentsOf<ColorLanguage> = {
  // @ts-expect-error and only the kinds it declares do
  controls: { ...components.controls, color: ColorControl, colour: ColorControl },
  cells: colorCells,
  nodes: components.nodes,
}
export const misspelledCell: ComponentsOf<ColorLanguage> = {
  controls: { ...components.controls, color: ColorControl },
  // @ts-expect-error a cell under a name no kind of the language draws with
  cells: { ...colorCells, colour: ColorCell },
  nodes: components.nodes,
}
export const wrongColor: ComponentsOf<ColorLanguage> = {
  // @ts-expect-error a color control is handed ControlProps like any other
  controls: { ...components.controls, color: ({ value }: { value: number }) => value.toFixed() },
  cells: colorCells,
  nodes: components.nodes,
}

// Rich text and files are add-ons: their controls and cells are asked for only by a language that declares their kinds.
type PlainLanguage = typeof import('./plain-language.ts').language
type TemplateLanguage = import('asas').Language
declare const richTextComponents: typeof import('../registry/rich-text.tsx').richTextComponents
declare const uploadComponents: typeof import('../registry/upload.tsx').uploadComponents
export const plain: ComponentsOf<PlainLanguage> = components
export const needlessRichText: ComponentsOf<PlainLanguage> = {
  ...components,
  // @ts-expect-error no kind of this language draws rich text, so the map takes no richText control
  controls: { ...components.controls, richText: richTextComponents.controls.richText },
}
// @ts-expect-error a language with rich text and files needs both add-on maps
export const bare: ComponentsOf<TemplateLanguage> = components
export const fileless: ComponentsOf<TemplateLanguage> = {
  nodes: components.nodes,
  // @ts-expect-error a language with files needs uploadComponents.controls besides rich text's
  controls: { ...components.controls, ...richTextComponents.controls },
  cells: { ...components.cells, ...richTextComponents.cells, ...uploadComponents.cells },
}
export const cellless: ComponentsOf<TemplateLanguage> = {
  nodes: components.nodes,
  controls: { ...components.controls, ...richTextComponents.controls, ...uploadComponents.controls },
  // @ts-expect-error and richTextComponents.cells besides the files'
  cells: { ...components.cells, ...uploadComponents.cells },
}
export const installed: ComponentsOf<TemplateLanguage> = {
  nodes: components.nodes,
  controls: { ...components.controls, ...richTextComponents.controls, ...uploadComponents.controls },
  cells: { ...components.cells, ...richTextComponents.cells, ...uploadComponents.cells },
}
