import { defaultFields, defaultJsonMaxBytes } from 'mithaq'
import { defineKayan, organization } from '@asas/mithaq'

/** Private sidecar rows: the rich-text service checks each record's own access before reading or writing. */
export const richTextThreads = defineKayan({
  name: 'richTextThreads',
  dbName: 'rich_text_threads',
  messages: { singular: { en: 'Comment thread', ar: 'سلسلة تعليقات' }, plural: { en: 'Comment threads', ar: 'سلاسل التعليقات' } },
  targets: { service: { operations: {} } },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: {
    ...defaultFields,
    organization,
    recordKayan: { kind: 'text', label: { en: 'Kayan', ar: 'الكيان' }, rules: { required: true, maxLength: 100, index: true } },
    recordId: { kind: 'text', label: { en: 'Record', ar: 'السجل' }, rules: { required: true, maxLength: 255, index: true } },
    field: { kind: 'text', label: { en: 'Field', ar: 'الحقل' }, rules: { required: true, maxLength: 100 } },
    quote: { kind: 'text', label: { en: 'Selected text', ar: 'النص المحدد' }, rules: { required: true, maxLength: 4000 } },
    resolved: { kind: 'checkbox', label: { en: 'Resolved', ar: 'محسوم' }, rules: { required: true } },
    comments: { kind: 'json', label: { en: 'Comments', ar: 'التعليقات' }, maxBytes: defaultJsonMaxBytes, rules: { required: true } },
  },
})
