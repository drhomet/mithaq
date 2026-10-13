import type { ReactElement, ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { ClientKayan, Row } from 'mithaq/admin'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { operationLabelFor, type Copy } from './copy.ts'
import type { PageButton, Places } from './nodes.tsx'

export type RowMenuProps = {
  kayan: ClientKayan
  copy: Copy
  row: Row
  /** The menu button's name, which names the row. */
  label: string
  /** Whether the row is opened to edit or only to view, or not offered at all. */
  opens?: 'edit' | 'view'
  onOpen: () => void
  /** The list node's row buttons drawn as items. */
  menu: readonly PageButton[]
  /** Whether a button's run is out, which holds every item that writes. */
  running: boolean
  onRun: (operation: PageButton) => void
  /** The project's own items, which may open a node beside the list. */
  Menu?: Places['menu']
  open: (node: ReactNode) => void
  /** Asks the delete, where the actor may delete. */
  onDelete?: () => void
}

/** One row's menu: View or Edit, the list node's row buttons, the project's own items, and Delete. */
export function RowMenu({ copy, kayan, label, Menu, menu, onDelete, onOpen, onRun, open, opens, row, running }: RowMenuProps): ReactElement {
  const { t } = copy
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-row-menu={String(row.id ?? '')}
        aria-label={label}
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'max-sm:size-11' })}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {opens === 'view' ? (
          <DropdownMenuItem data-row-action="view" className="max-sm:min-h-11" onClick={onOpen}>
            {t('admin.view', 'View') ?? 'View'}
          </DropdownMenuItem>
        ) : opens === 'edit' ? (
          <DropdownMenuItem data-row-action="edit" className="max-sm:min-h-11" onClick={onOpen}>
            {t('admin.edit', 'Edit') ?? 'Edit'}
          </DropdownMenuItem>
        ) : null}
        {menu.map((operation) => (
          <DropdownMenuItem
            key={operation.name}
            data-row-action={operation.name}
            className="max-sm:min-h-11"
            disabled={running}
            onClick={() => onRun(operation)}
          >
            {operationLabelFor({ kayan, operation, copy })}
          </DropdownMenuItem>
        ))}
        {Menu ? <Menu row={row} open={open} /> : null}
        {onDelete ? (
          <DropdownMenuItem data-row-action="delete" variant="destructive" className="max-sm:min-h-11" disabled={running} onClick={onDelete}>
            {t('admin.delete', 'Delete') ?? 'Delete'}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
// mithaq-admin 7fc64834f9ec8682c4c34f35d23a21736cf89a50 b9f00854291180fdd85e7ebe77eb17c994b0842ce58a1d9b6b9106c194bde4d2
