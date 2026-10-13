import type { Cell, Control } from './control-props.ts'
import { UploadCell } from './upload-cell.tsx'
import { UploadControl } from './upload-control.tsx'

// ponytail: what this file exported before its pieces were split out, kept for one version so a project's own file
// importing one from here still builds after recopying; drop it the next minor and import each from its piece.
// The rich text node's half moved to upload-node.tsx and is not re-exported, since it would make files need rich text.
export { FileThumb, FileValue } from './file-thumb.tsx'
export { put, refusedFile, sizeOf, typeName, typeNames, uploadFile } from './upload-api.ts'
export { UploadCell, UploadValue } from './upload-cell.tsx'
export { UploadControl } from './upload-control.tsx'
export { UploadDialog, askedFields } from './upload-dialog.tsx'

/** What a project whose language holds the `upload` kind (the storage rukn) spreads into its components map, beside `defaultComponents`. */
export const uploadComponents: { controls: { readonly upload: Control }; cells: { readonly upload: Cell } } = {
  controls: { upload: UploadControl },
  cells: { upload: UploadCell },
}
