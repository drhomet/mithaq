// What every upload kayan of this project draws its own files with: mithaq-admin's pieces, handed this project's
// locales, and its New page in the app shell. The dashboard registers each by name, so a kayan names them as it names
// any other piece, and one that wants its own names a `ui()` reference in their place.
import type { ComponentProps } from 'mithaq/admin'
import { useKayan, useLocale } from 'mithaq/admin/react'
import { locales } from '@/copy.ts'
import { FileDetails as Details, NewUpload as New } from 'mithaq-admin/upload-pages.tsx'
import { AppShell } from './app-shell.tsx'

export { FileCell, FileSizeCell } from 'mithaq-admin/upload-pages.tsx'

/** The file beside its edit form, with Download and Replace file. */
export const FileDetails = () => <Details locales={locales} />

/** The New page, which the list's New button opens: the upload dialog in the app shell, under the kayan's own New. */
export function NewUpload(_props: ComponentProps) {
  const { t } = useLocale()
  const kayan = useKayan()
  return <AppShell regions={{ primary: null, more: null, header: <h1>{t(`${kayan.name}.new`, t('admin.new', 'New'))}</h1>, main: <New locales={locales} /> }} />
}
