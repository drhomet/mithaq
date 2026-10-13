import { defaultFields, defaultOperations, folderOf, uploadFields, withUploadReference, type Where } from 'mithaq'
import { defineKayan, organization } from '@asas/mithaq'
import { readsPast } from '@asas/mithaq/roles/tenant-access.ts'
import { appPage, danger } from '@asas/mithaq/mithaq/pages.ts'
import { storageConfig } from '@asas/mithaq/storage/index.ts'

const ui = folderOf(new URL('./ui/', import.meta.url))

/**
 * One way an actor that holds no `media.create` reads an image: the images it
 * may read, or `false` for none. Never `true`, which would open every image of
 * the organization to whoever the read answered it for.
 */
export type ImageRead = (args: { user: unknown }) => Promise<Where | false>

/**
 * The images an actor reads, inside its active organization: every image of
 * its organization where it holds `media.create`, and otherwise only those one
 * of `reads` answers. `media.create` is the line because a role that adds
 * images has to find one before anything names it, in an upload field's
 * picker. A file at `GET /api/media/file/<id>` is read through this kayan's
 * own `findByID`, so the same answer decides who downloads it.
 */
const imagesReadBy = (reads: readonly ImageRead[]) => async ({ user }: { user: unknown }) => {
  if (readsPast(user, 'media.create')) return true
  const answered: unknown[] = await Promise.all(reads.map((read) => read({ user })))
  // The type forbids it, but a cast `true` or a filter of nothing would open every image of the
  // organization, so either throws and the actor reads none.
  for (const [at, answer] of answered.entries()) {
    if (answer !== false && (!answer || typeof answer !== 'object' || !Object.keys(answer).length)) {
      throw new Error(`The image read ${reads[at]!.name || `at ${at}`} answered ${JSON.stringify(answer)}, which would open every image; a read answers false or a filter.`)
    }
  }
  const answers = answered.filter((one): one is Where => one !== false)
  if (!answers.length) return false
  return answers.length === 1 ? answers[0]! : { or: answers }
}

/**
 * The organization's images: a row per file, whose object is kept where the
 * project's storage puts it. An upload field points at one, as a course's cover does.
 *
 * It spreads `uploadFields`, the columns the create writes from the upload it
 * verified and nobody writes after, and declares its own create and delete:
 * the create takes the signed `uploadReference` that
 * `POST /api/media/uploadInstructions` handed out and runs the project's
 * `uploaded`, and the delete runs its `removed` after the commit. `buildAsas`
 * refuses a create that skips the configured `uploaded`. A file is
 * read at `GET /api/media/file/<id>` through this kayan's own `findByID`, so
 * its organization and `reads` decide who reads it. It keeps no versions, since a file never changes once it is
 * made; a kayan pointing at one keeps the versions of that pointer instead.
 */
export const media = ({ reads }: { reads: readonly ImageRead[] }) => defineKayan({
  name: 'media',
  // ANDed with the inherited rows, so it narrows and never widens.
  access: { read: imagesReadBy(reads) },
  messages: {
    singular: { en: 'Image', ar: 'صورة' },
    plural: { en: 'Images', ar: 'الصور' },
  },
  targets: {
    storage: { mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    // A file is named by its name wherever it stands for itself: the upload
    // control's picker and a relationship column pointing here.
    portal: { useAsTitle: 'filename' },
    // The organization's images, listed and re-described. A file is made
    // where it is used, by the upload control, and on this kayan's own New
    // page, both through the upload dialog, which sends it before the row is
    // made. The list draws each image's thumbnail beside its name and its size as a
    // person reads it. The file's own columns are the runner's, so the edit
    // page draws them read-only, with the image, its size, Download and
    // Replace file beside the form, and above it on a phone.
    dashboard: {
      useAsTitle: 'filename',
      description: { en: 'The images this organization uses, each with the words a screen reader says for it.', ar: 'الصور التي تستخدمها هذه المؤسسة، ولكل منها الكلمات التي يقرؤها قارئ الشاشة.' },
      pages: {
        list: { path: '/media', page: appPage([{ layout: 'table', main: [{ list: {
          columns: [{ field: 'filename', cell: ui('preview.tsx#FileName') }, 'alt', 'mimeType', { field: 'filesize', cell: ui('preview.tsx#FileSize') }, 'createdAt'],
          search: ['filename'],
          sort: '-createdAt',
        } }] }]) },
        create: { path: '/media/new', component: ui('preview.tsx#NewImage') },
        edit: {
          path: '/media/:id',
          page: appPage([{
            layout: 'record',
            main: [{ form: [
              { section: 'description', label: { en: 'Description', ar: 'الوصف' }, fields: ['alt'] },
              { section: 'file', label: { en: 'File', ar: 'الملف' }, fields: ['filename', 'mimeType', { row: ['width', 'height'] }] },
            ] }],
            side: [{ component: ui('preview.tsx#MediaPreview') }],
            danger: danger(),
          }]),
        },
      },
    },
    service: {
      operations: {
        ...defaultOperations,
        // The upload inside the create. Before the transaction opens, the
        // signed reference is checked and the stored object is read back,
        // and every file column is written from what the server measured.
        // Then the row is made in one insert.
        create: {
          ...defaultOperations.create,
          input: ({ create }) => withUploadReference(create),
          beforeTransaction: [storageConfig.uploaded],
        },
        // The object is removed only once the row's removal has committed,
        // so a failure leaves an orphan for the sweep and never a row that
        // names nothing.
        delete: {
          ...defaultOperations.delete,
          afterCommit: ({ afterCommit }) => [...afterCommit, storageConfig.removed],
        },
      },
    },
  },
  fields: {
    ...defaultFields,
    organization,
    ...uploadFields,
    // What a screen reader says for the image, in every locale, since an
    // image with no words is no image to someone who cannot see it.
    alt: {
      kind: 'text',
      label: { en: 'Alternative text', ar: 'النص البديل' },
      rules: { localized: true, required: true, maxLength: 300 },
    },
  },
})
