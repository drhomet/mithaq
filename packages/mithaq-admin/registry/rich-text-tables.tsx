import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { INSERT_TABLE_COMMAND, TableNode, TableRowNode, TableCellNode, $insertTableRowAtSelection, $insertTableColumnAtSelection, $deleteTableRowAtSelection, $deleteTableColumnAtSelection, $getTableCellNodeFromLexicalNode, $isTableSelection } from '@lexical/table'
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export const nodes = [TableNode, TableRowNode, TableCellNode]
export function Plugin() { return <TablePlugin hasCellMerge={false} hasCellBackgroundColor={false} hasHorizontalScroll /> }
export function Buttons({ t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const change = (action: () => void) => editor.update(() => {
    const selection = $getSelection()
    if (($isRangeSelection(selection) || $isTableSelection(selection)) && $getTableCellNodeFromLexicalNode(selection.anchor.getNode())) action()
  })
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" />}>{t('admin.richText.table', 'Table')}</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem onClick={() => editor.update(() => {
        if (!$getSelection()) {
          const paragraph = $createParagraphNode()
          $getRoot().append(paragraph)
          paragraph.select()
        }
        editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '3', columns: '3', includeHeaders: true })
      })}>{t('admin.richText.insertTable', 'Insert table')}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => change(() => { $insertTableRowAtSelection() })}>{t('admin.richText.addRow', 'Add row')}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => change(() => { $insertTableColumnAtSelection() })}>{t('admin.richText.addColumn', 'Add column')}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => change($deleteTableRowAtSelection)}>{t('admin.richText.deleteRow', 'Delete row')}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => change($deleteTableColumnAtSelection)}>{t('admin.richText.deleteColumn', 'Delete column')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
