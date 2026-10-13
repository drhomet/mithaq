import { use, useEffect, useState, type ReactElement } from 'react'
import { ImageIcon } from 'lucide-react'
import { $create, COMMAND_PRIORITY_EDITOR, createCommand } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import type { ClientField } from 'mithaq/admin'
import { ScreenContext } from 'mithaq/admin/react'
import { UploadNode } from 'mithaq/rich-text'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ControlProps, FindApi, FoundPage } from './control-props.ts'
import type { Translate } from './copy.ts'
import { FileValue, Missing } from './file-thumb.tsx'
import type { RichTextPick } from './rich-text-picks.tsx'
import type { Row } from './upload-api.ts'
import { UploadControl } from './upload-control.tsx'

// The rich text node is opt-in: a project lists `UploadNode` from `mithaq/rich-text` among its nodes,
// `UploadView` among its views, `imagePick` among its picks and `UploadPlugin` as the editor's plugin.

/** What the `/` menu's "Image" asks the editor for, which `UploadPlugin` answers with its dialog. */
export const INSERT_UPLOAD_COMMAND = createCommand<void>('INSERT_UPLOAD_COMMAND')

/** The `/` menu's "Image", in each locale's own words. */
export const imagePick: RichTextPick = {
  key: 'upload',
  label: { en: 'Image', ar: 'صورة' },
  Icon: ImageIcon,
  keywords: ['image', 'upload', 'picture', 'photo', 'صورة'],
  onSelect: ({ editor }) => editor.dispatchCommand(INSERT_UPLOAD_COMMAND, undefined),
}

/**
 * A file inside the text, read by its id through the screen's client so the row's own access
 * decides, and drawn off the row's computed `url`. A file the viewer may not read, or of a kayan this screen holds no files of, draws the placeholder.
 */
function UploadImage({ relationTo, value, format }: { relationTo: string; value: string; format: string }): ReactElement {
  const screen = use(ScreenContext)
  const t: Translate = screen?.t ?? ((_key, fallback) => fallback)
  const locale = screen?.locale ?? 'en'
  const readable = !!screen?.screen.kayan[relationTo]?.storage
  const [row, setRow] = useState<Row | null | false>(readable ? null : false)
  useEffect(() => {
    if (!screen || !readable) return setRow(false)
    let live = true
    screen.client({ kayan: relationTo, operation: 'find', input: { where: { id: { equals: value } }, limit: 1 } })
      .then((found) => live && setRow((found as FoundPage).docs[0] ?? false), () => live && setRow(false))
    return () => {
      live = false
    }
  }, [relationTo, value, readable, screen?.client])
  const align = format === 'center' ? 'justify-center' : format === 'right' || format === 'end' ? 'justify-end' : 'justify-start'
  return (
    <div data-upload-node={value} className={`my-2 flex ${align}`}>
      {row === null ? <span className="bg-muted size-24 animate-pulse rounded-md" /> : row ? <FileValue row={row} t={t} locale={locale} /> : <Missing t={t} size="lg" />}
    </div>
  )
}

/** The node's React half: `UploadNode`'s type and data, drawn by `UploadImage`. */
export class UploadView extends UploadNode {
  $config() {
    return this.config('upload', { extends: UploadNode })
  }

  decorate(): ReactElement {
    return <UploadImage relationTo={this.getRelationTo()} value={this.getValue()} format={this.getFormat()} />
  }
}

/**
 * The editor's half of "Image": a dialog holding the upload control over the screen's first kayan that holds files,
 * so a file is chosen or uploaded as a field's is; the node goes in its own block where the selection was.
 */
export function UploadPlugin(props: ControlProps): ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const screen = use(ScreenContext)
  const [open, setOpen] = useState(false)
  useEffect(() => editor.registerCommand(INSERT_UPLOAD_COMMAND, () => (setOpen(true), true), COMMAND_PRIORITY_EDITOR), [editor])
  const target = Object.values(screen?.screen.kayan ?? {}).find((one) => one.storage)
  if (!screen || !target) return null
  const { t } = props
  const api: FindApi = { [target.name]: { find: (input) => screen.client({ kayan: target.name, operation: 'find', input }) as Promise<FoundPage> } }
  const field: ClientField = { name: 'upload', kind: 'upload', relationTo: target.name, rules: {}, component: 'upload', cell: 'upload', label: { [props.locale ?? 'en']: t('admin.upload.image', 'Image') ?? 'Image' } }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} data-upload-insert="">
        <DialogHeader>
          <DialogTitle>{t('admin.upload.insert', 'Insert an image') ?? 'Insert an image'}</DialogTitle>
          <DialogDescription>{t('admin.upload.insertHint', 'Choose a file already here, or upload a new one.') ?? ''}</DialogDescription>
        </DialogHeader>
        <UploadControl
          {...props}
          id={`${props.id}-upload`}
          field={field}
          kayan={target}
          client={[target, ...(props.client ?? [])]}
          api={api}
          value={null}
          readOnly={false}
          onChange={(next) => {
            if (typeof next !== 'string') return
            editor.update(() => void $insertNodeToNearestRoot($create(UploadView).setUpload(target.name, next)))
            setOpen(false)
          }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
