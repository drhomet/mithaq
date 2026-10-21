import { defaultFields } from 'mithaq'
import { z } from 'zod'
import { defineKayan, organization } from '@asas/mithaq'
import { appPage, danger, backofficeList, backofficeRecord, navGroups } from '@asas/mithaq/mithaq/pages.ts'
import { expectedUpdatedAt } from '@asas/mithaq/steps/expected-updated-at.ts'

const tag = [{ section: 'tag', label: { en: 'Tag', ar: 'الوسم' }, fields: ['name'] }] as const

/**
 * A label a course may carry any number of, and which any number of courses may
 * carry: the other end of `courses.tags`, the one many-to-many this template
 * declares. It places `organization`, so a tag is its organization's own and
 * the runner refuses a course pointing at another tenant's tag.
 */
export const tags = defineKayan({
  name: 'tags',
  messages: {
    singular: { en: 'Tag', ar: 'وسم' },
    plural: { en: 'Tags', ar: 'الوسوم' },
  },
  // What the picker on `courses.tags` shows for each row, and what its search
  // runs a `like` over. Without it every tag is a uuid.
  targets: {
    // Every organization's rows on the backoffice, read-only, and each row's
    // record, which only reads.
    backoffice: {
      nav: { icon: 'tags', group: navGroups.library },
      useAsTitle: 'name',
      pages: {
        ...backofficeList('/tags', { columns: ['name', 'organization', 'createdAt'], filters: ['organization'], search: ['name'] }),
        ...backofficeRecord({ path: '/tags/:id', main: [{ section: 'tag', label: { en: 'Tag', ar: 'الوسم' }, fields: ['name'] }] }),
      },
    },
    // A create opens as a sheet over the list. The name is copy a screen shows
    // as a label, so it is one string per locale, and every screen reads it in
    // the viewer's.
    dashboard: {
      nav: { icon: 'tags', group: navGroups.library },
      useAsTitle: 'name',
      description: {
        en: 'Labels the organization groups its records by.',
        ar: 'تسميات تجمع بها المؤسسة سجلاتها.',
      },
      pages: {
        list: { path: '/tags', page: appPage([{ layout: 'table', main: [{ list: { columns: ['name', 'createdAt'], search: ['name'] } }] }]) },
        // The drawer's title says it makes a tag, so its one box is drawn
        // bare rather than under a second heading that says "Tag" again.
        create: { path: '/tags/new', mode: 'drawer', page: appPage([{ layout: 'record', main: [{ form: ['name'] }] }]) },
        edit: { path: '/tags/:id', page: appPage([{ layout: 'record', main: [{ form: tag }] }], { more: danger() }) },
      },
    },
    service: {
      operations: ({ defaults }) => ({
        ...defaults,
        /**
         * The shipped update list with the `expectedUpdatedAt` step before it and
         * its input widened by the key the step reads. A caller who sends the
         * instant it read the tag at is refused 409 when the tag has changed
         * since. The dashboard's edit form sends it, because the screen host
         * reads that this input takes the key, so a second tab's stale save is
         * the 409. The key stays optional, so a caller that sends none, a bulk
         * update among them, saves as before.
         */
        update: {
          input: ({ update }) => update.extend({ expectedUpdatedAt: z.date().optional() }),
          steps: ({ steps }) => [expectedUpdatedAt, steps.update],
        },
      }),
    },
  },
  fields: {
    ...defaultFields,
    organization,
    name: {
      kind: 'text',
      label: { en: 'Name', ar: 'الاسم' },
      // Each locale trimmed before it is judged, so a name of spaces is refused
      // as required.
      rules: { localized: true, required: true, trim: true, maxLength: 60, index: true },
    },
  },
})
