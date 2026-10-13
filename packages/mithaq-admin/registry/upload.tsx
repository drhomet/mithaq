import type { Cell, Control } from 'mithaq-admin/control-props.ts'
import { UploadCell } from 'mithaq-admin/upload-cell.tsx'
import { UploadControl } from 'mithaq-admin/upload-control.tsx'

// ponytail: what this file exported before its pieces were split out, kept for one version so a project's own file
// importing one from here still builds after recopying; drop it the next minor and import each from its piece.
// The rich text node's half moved to upload-node.tsx and is not re-exported, since it would make files need rich text.
export { FileThumb, FileValue } from 'mithaq-admin/file-thumb.tsx'
export { put, refusedFile, sizeOf, typeName, typeNames, uploadFile } from 'mithaq-admin/upload-api.ts'
export { UploadCell, UploadValue } from 'mithaq-admin/upload-cell.tsx'
export { UploadControl } from 'mithaq-admin/upload-control.tsx'
export { UploadDialog, askedFields } from 'mithaq-admin/upload-dialog.tsx'

/** What a project whose language holds the `upload` kind (the storage rukn) spreads into its components map, beside `defaultComponents`. */
export const uploadComponents: { controls: { readonly upload: Control }; cells: { readonly upload: Cell } } = {
  controls: { upload: UploadControl },
  cells: { upload: UploadCell },
}
