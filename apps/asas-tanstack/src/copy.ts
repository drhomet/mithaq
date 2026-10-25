// Imports no router, stylesheet or React, so a test can load this under plain `node`.
import { flattenMessageFile } from 'mithaq/admin'
import { organizations, showOrganization } from 'asas/organizations'
import mithaq from 'asas/messages/mithaq.json' with { type: 'json' }
import localUsers from 'asas/messages/localUsers.json' with { type: 'json' }
import organization from 'asas/messages/organization.json' with { type: 'json' }
import tags from 'asas/messages/tags.json' with { type: 'json' }
// add-on: audit-log
import auditLog from 'asas/messages/auditLog.json' with { type: 'json' }
import backofficeLog from 'asas/messages/backofficeLog.json' with { type: 'json' }
// end add-on: audit-log
// add-on: courses
import courses from 'asas/messages/courses.json' with { type: 'json' }
import enrollments from 'asas/messages/enrollments.json' with { type: 'json' }
import sessions from 'asas/messages/sessions.json' with { type: 'json' }
// end add-on: courses
// add-on: media
import media from 'asas/messages/media.json' with { type: 'json' }
// end add-on: media
// add-on: roles
import memberRoles from 'asas/messages/memberRoles.json' with { type: 'json' }
import roles from 'asas/messages/roles.json' with { type: 'json' }
// end add-on: roles
// add-on: settings
import settings from 'asas/messages/settings.json' with { type: 'json' }
// end add-on: settings

// Restated, not imported: the original lives in a `.tsx` file and the test runner has no JSX compiler.
type Translate = (key: string, fallback?: string) => string | undefined

/** The locales this project declares. */
export const locales = ['ar', 'en'] as const

/** The app reads either message-file format during the upgrade release. */
export const copyFile = (file: Record<string, unknown>): Record<string, Record<string, string>> =>
  Object.fromEntries(Object.entries(flattenMessageFile({ file, locales })).map(([key, value]) =>
    [key, typeof value === 'string' ? Object.fromEntries(locales.map((locale) => [locale, value])) : value ?? {}]))

/** One of the locales this project declares. */
export type Locale = (typeof locales)[number]

/** The name of the cookie that carries a viewer's chosen locale. */
export const localeCookie = 'locale'

const localeCookieMaxAge = 60 * 60 * 24 * 365

/**
 * The cookie value for a chosen locale. No `HttpOnly`, because the browser script
 * writes it; no `Secure`, because the dev server is plain HTTP and the choice is not a credential.
 */
export const localeCookieValue = (locale: Locale): string =>
  `${localeCookie}=${locale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax`

/**
 * Which locale one request reads in. The value comes from a request header a caller
 * writes, so anything but a declared locale becomes `en`; nothing downstream asks again.
 */
export const localeOf = (asked: string | null | undefined): Locale =>
  (locales as readonly string[]).includes(asked ?? '') ? (asked as Locale) : 'en'

/** Which way a document in one locale runs. */
export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (locale === 'ar' ? 'rtl' : 'ltr')

/** The copy every organization mode starts from; `scopes` below lays the mode's words over it. */
const ownScopes: Record<string, Record<string, Record<string, string>>> = {
  // add-on: courses
  courses: {
    ...copyFile(courses),
    'delete.confirm': { en: 'Delete this course', ar: 'احذف هذه الدورة' },
    dangerZoneWarning: { en: 'These actions change this course for everyone.', ar: 'هذه الإجراءات تغير هذه الدورة للجميع.' },
    none: { en: 'No courses yet.', ar: 'لا توجد دورات بعد.' },
    noneOnOffer: { en: 'No courses on offer yet.', ar: 'لا توجد دورات معروضة بعد.' },
    'operations.archive': { en: 'Archive', ar: 'أرشفة' },
    'operations.archive.warning': { en: 'This archives {name}.', ar: 'يؤرشف هذا الإجراء {name}.' },
    'operations.findWithSessions': { en: 'View with its sessions', ar: 'عرض مع جلساتها' },
    new: { en: 'New course', ar: 'دورة جديدة' },
    'archived.true': { en: 'Archived', ar: 'مؤرشف' },
    'archived.false': { en: 'Active', ar: 'نشط' },
    'operations.archive.reason.required': {
      en: 'An archive reason is required.',
      ar: 'سبب الأرشفة مطلوب.',
    },
    'operations.archive.reason.maxLength': {
      en: 'An archive reason is at most 200 characters.',
      ar: 'سبب الأرشفة 200 حرف على الأكثر.',
    },
    'operations.unarchive': { en: 'Unarchive', ar: 'إلغاء الأرشفة' },
    'operations.unarchive.reason.required': { en: 'A reason to bring it back is required.', ar: 'سبب إلغاء الأرشفة مطلوب.' },
    'operations.unarchive.reason.maxLength': { en: 'A reason to bring it back is at most 200 characters.', ar: 'سبب إلغاء الأرشفة 200 حرف على الأكثر.' },
    'operations.unpublish': { en: 'Unpublish', ar: 'إلغاء النشر' },
  },
  // end add-on: courses
  admin: {
    sortBy: { en: 'Sort by', ar: 'الترتيب حسب' },
    ascending: { en: 'Ascending', ar: 'تصاعدي' },
    descending: { en: 'Descending', ar: 'تنازلي' },
    defaultOrder: { en: 'Default order', ar: 'الترتيب الافتراضي' },
    nav: { en: 'Admin', ar: 'الإدارة' },
    emptyValue: { en: 'Empty', ar: 'فارغ' },
    archived: { en: 'Archived', ar: 'مؤرشف' },
    active: { en: 'Active', ar: 'نشط' },
    openEmpty: { en: 'Empty, open', ar: 'فارغ، فتح' },
    yes: { en: 'Yes', ar: 'نعم' },
    no: { en: 'No', ar: 'لا' },
    navigation: { en: 'Navigation', ar: 'التنقل' },
    navigationAbout: { en: 'The pages you can open.', ar: 'الصفحات التي يمكنك فتحها.' },
    mainNavigation: { en: 'Main navigation', ar: 'التنقل الرئيسي' },
    notFound: { en: 'That page does not exist.', ar: 'هذه الصفحة غير موجودة.' },
    notFoundTitle: { en: 'Page not found', ar: 'الصفحة غير موجودة' },
    goHome: { en: 'Go to the home page', ar: 'الذهاب إلى الصفحة الرئيسية' },
    new: { en: 'New', ar: 'جديد' },
    createTitle: { en: 'Create {kind}', ar: 'إنشاء {kind}' },
    save: { en: 'Save', ar: 'حفظ' },
    afterCommitFailed: {
      en: 'Saved, but a follow-up action failed, so something this save should have caused, such as an email or a notification, may be missing. Please contact an administrator.',
      ar: 'تم الحفظ، لكن تعذر إجراء لاحق، فقد يكون ما كان ينبغي أن يتبع هذا الحفظ، كرسالة بريد أو إشعار، مفقودا. يرجى التواصل مع المسؤول.',
    },
    delete: { en: 'Delete', ar: 'حذف' },
    impersonating: { en: 'You are impersonating', ar: 'أنت تنتحل صفة' },
    stopImpersonating: { en: 'Stop impersonating', ar: 'إيقاف انتحال الصفة' },
    cancel: { en: 'Cancel', ar: 'إلغاء' },
    close: { en: 'Close', ar: 'إغلاق' },
    'done.created': { en: '{kind} created', ar: 'تم إنشاء {kind}' },
    'done.saved': { en: '{kind} saved', ar: 'تم حفظ {kind}' },
    'done.published': { en: '{kind} published', ar: 'تم نشر {kind}' },
    'done.draftSaved': { en: 'Draft saved', ar: 'تم حفظ المسودة' },
    'done.deleted': { en: '{kind} deleted', ar: 'تم حذف {kind}' },
    'done.archive': { en: '{kind} archived', ar: 'تمت أرشفة {kind}' },
    'done.unarchive': { en: '{kind} unarchived', ar: 'تم إلغاء أرشفة {kind}' },
    'done.unpublish': { en: '{kind} unpublished', ar: 'تم إلغاء نشر {kind}' },
    'done.restoreVersion': { en: 'Version restored', ar: 'استُعيدت النسخة' },
    'done.ran': { en: '{operation}: done', ar: '{operation}: تم' },
    requestFailed: { en: 'Something went wrong, so nothing was saved. Try again.', ar: 'حدث خطأ، فلم يُحفظ شيء. حاول مرة أخرى.' },
    deleteWarning: { en: 'This cannot be undone.', ar: 'لا يمكن التراجع عن هذا.' },
    deleteConfirm: { en: 'Delete for good', ar: 'احذف نهائيا' },
    deleteFailed: { en: 'Something went wrong, so nothing was deleted. Try again.', ar: 'حدث خطأ، فلم يُحذف شيء. حاول مرة أخرى.' },
    discard: { en: 'Discard changes', ar: 'تجاهل التغييرات' },
    discardWarning: {
      en: 'You have unsaved changes. Leave without saving?',
      ar: 'توجد تغييرات غير محفوظة. هل تريد المغادرة دون حفظ؟',
    },
    discardKeepsDraft: { en: 'The draft saved so far is kept.', ar: 'تبقى المسودة المحفوظة حتى الآن.' },
    dangerZone: { en: 'Danger zone', ar: 'منطقة الخطر' },
    dangerZoneWarning: {
      en: 'These actions change this {kind} for everyone.',
      ar: 'هذه الإجراءات تغير هذا السجل ({kind}) للجميع.',
    },
    edit: { en: 'Edit', ar: 'تعديل' },
    view: { en: 'View', ar: 'عرض' },
    rowActions: { en: 'Row actions', ar: 'إجراءات الصف' },
    rowActionsFor: { en: 'Actions for {name}', ar: 'إجراءات {name}' },
    openRow: { en: 'Press Enter to open this row.', ar: 'اضغط Enter لفتح هذا الصف.' },
    untitled: { en: 'Untitled', ar: 'بدون عنوان' },
    openUntitled: { en: 'Untitled, open', ar: 'بدون عنوان، فتح' },
    missingComponent: {
      en: 'No component is registered for "{component}".',
      ar: 'لا يوجد مكون مسجل لـ "{component}".',
    },
    missingLayout: {
      en: 'No component is registered for layout "{layout}".',
      ar: 'لا يوجد مكون مسجل للتخطيط "{layout}".',
    },
    page: { en: 'Page', ar: 'صفحة' },
    perPage: { en: 'Per page', ar: 'لكل صفحة' },
    of: { en: 'of', ar: 'من' },
    first: { en: 'First', ar: 'الأول' },
    previous: { en: 'Previous', ar: 'السابق' },
    next: { en: 'Next', ar: 'التالي' },
    last: { en: 'Last', ar: 'الأخير' },
    search: { en: 'Search', ar: 'بحث' },
    bulkBar: { en: 'Ticked rows', ar: 'الصفوف المحددة' },
    searchThrough: { en: '{relation} {field}', ar: '{field} ({relation})' },
    clearSearch: { en: 'Clear search', ar: 'مسح البحث' },
    filters: { en: 'Filters', ar: 'المرشحات' },
    empty: { en: 'Nothing here yet.', ar: 'لا شيء هنا بعد.' },
    loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
    clear: { en: 'Clear', ar: 'مسح' },
    unset: { en: 'unset', ar: 'غير محدد' },
    pickDate: { en: 'Pick a date', ar: 'اختر تاريخا' },
    // add-on: rich-text-find-replace
    'richText.findReplace': { en: "Find and replace", ar: "بحث واستبدال" },
    'richText.find': { en: "Find", ar: "بحث" },
    'richText.replaceWith': { en: "Replace with", ar: "استبدال بـ" },
    'richText.matchCase': { en: "Match case", ar: "مطابقة حالة الأحرف" },
    'richText.wholeWord': { en: "Whole word", ar: "كلمة كاملة" },
    'richText.matches': { en: "matches", ar: "نتائج" },
    'richText.previous': { en: "Previous", ar: "السابق" },
    'richText.next': { en: "Next", ar: "التالي" },
    'richText.replace': { en: "Replace", ar: "استبدال" },
    'richText.replaceAll': { en: "Replace all", ar: "استبدال الكل" },
    // end add-on: rich-text-find-replace
    // add-on: rich-text-mentions
    'richText.mentions': { en: "Mention a record", ar: "الإشارة إلى سجل" },
    'richText.mentionsUnavailable': { en: "Some sources could not be read.", ar: "تعذرت قراءة بعض المصادر." },
    'richText.noMentions': { en: "No matching records.", ar: "لا توجد سجلات مطابقة." },
    'richText.emoji': { en: "Emoji", ar: "رموز تعبيرية" },
    'richText.emoji.smile': { en: 'Smile', ar: 'وجه مبتسم' },
    'richText.emoji.heart': { en: 'Heart', ar: 'قلب' },
    'richText.emoji.thumbsup': { en: 'Thumbs up', ar: 'إعجاب' },
    'richText.emoji.check': { en: 'Check', ar: 'علامة صح' },
    'richText.emoji.tada': { en: 'Celebrate', ar: 'احتفال' },
    // end add-on: rich-text-mentions
    // add-on: rich-text-comments
    'richText.comments': { en: "Comments", ar: "التعليقات" },
    'richText.openComments': { en: "Open", ar: "مفتوحة" },
    'richText.resolvedComments': { en: "Resolved", ar: "محسومة" },
    'richText.saveBeforeComment': { en: "Save this record before adding comments.", ar: "احفظ السجل قبل إضافة التعليقات." },
    'richText.commentsFailed': { en: "Comments could not be loaded.", ar: "تعذر تحميل التعليقات." },
    'richText.commentRefused': { en: "The comment could not be saved. Check that you may still update this record.", ar: "تعذر حفظ التعليق. تحقق من صلاحية تعديل السجل." },
    'richText.orphanComment': { en: "The marked text has been removed.", ar: "حُذف النص المحدد." },
    'richText.you': { en: "You", ar: "أنت" },
    'richText.anotherAuthor': { en: "Another author", ar: "كاتب آخر" },
    'richText.editComment': { en: "Edit", ar: "تعديل" },
    'richText.deleteComment': { en: "Delete", ar: "حذف" },
    'richText.replyComment': { en: "Reply", ar: "رد" },
    'richText.reopenComment': { en: "Reopen", ar: "إعادة فتح" },
    'richText.resolveComment': { en: "Resolve", ar: "حسم" },
    'richText.noComments': { en: "No comments in this view.", ar: "لا توجد تعليقات في هذا العرض." },
    'richText.moreComments': { en: "Load more", ar: "تحميل المزيد" },
    'richText.selectToComment': { en: "Select unmarked text and open Comments to start a thread.", ar: "حدد نصا بلا تعليق ثم افتح التعليقات لبدء سلسلة." },
    'richText.commentText': { en: "Comment", ar: "التعليق" },
    'richText.saveComment': { en: "Save comment", ar: "حفظ التعليق" },
    'richText.addComment': { en: "Add comment", ar: "إضافة تعليق" },
    'richText.selectionTooLong': { en: 'Select at most 4000 characters.', ar: 'حدد نصا لا يتجاوز 4000 حرف.' },
    // end add-on: rich-text-comments
    'richText.words': { en: 'words', ar: 'كلمة' },
    'richText.characters': { en: 'characters', ar: 'حرف' },
    'richText.table': { en: 'Table', ar: 'جدول' },
    'richText.insertTable': { en: 'Insert table', ar: 'إدراج جدول' },
    'richText.addRow': { en: 'Add row', ar: 'إضافة صف' },
    'richText.addColumn': { en: 'Add column', ar: 'إضافة عمود' },
    'richText.deleteRow': { en: 'Delete row', ar: 'حذف الصف' },
    'richText.deleteColumn': { en: 'Delete column', ar: 'حذف العمود' },
    'richText.codeBlock': { en: 'Code block', ar: 'كتلة شيفرة' },
    'richText.color': { en: 'Colour', ar: 'اللون' },
    'richText.size': { en: 'Size', ar: 'الحجم' },
    'richText.font': { en: 'Font', ar: 'الخط' },
    'richText.styling': { en: 'Text style', ar: 'نمط النص' },
    'richText.direction': { en: 'Block direction', ar: 'اتجاه الفقرة' },
    'richText.auto': { en: 'Auto', ar: 'تلقائي' },
    'richText.rtl': { en: 'Right to left', ar: 'من اليمين لليسار' },
    'richText.ltr': { en: 'Left to right', ar: 'من اليسار لليمين' },
    'richText.selectionToolbar': { en: 'Selection formatting', ar: 'تنسيق التحديد' },
    'richText.choice.inherit': { en: 'Inherit', ar: 'موروث' },
    'richText.choice.default': { en: 'Default', ar: 'افتراضي' },
    'richText.choice.primary': { en: 'Primary', ar: 'أساسي' },
    'richText.choice.muted': { en: 'Muted', ar: 'خفيف' },
    'richText.choice.destructive': { en: 'Red', ar: 'أحمر' },
    'richText.choice.small': { en: 'Small', ar: 'صغير' },
    'richText.choice.normal': { en: 'Normal', ar: 'عادي' },
    'richText.choice.large': { en: 'Large', ar: 'كبير' },
    'richText.choice.sans': { en: 'Sans', ar: 'بلا زوائد' },
    'richText.choice.serif': { en: 'Serif', ar: 'بزوائد' },
    'richText.choice.mono': { en: 'Monospace', ar: 'متساوي العرض' },
    'richText.undo': { en: 'Undo', ar: 'تراجع' },
    'richText.redo': { en: 'Redo', ar: 'إعادة' },
    'richText.toolbar': { en: 'Formatting', ar: 'التنسيق' },
    'richText.blockFormatCurrent': { en: 'Block format: {block}', ar: 'نوع الفقرة: {block}' },
    'richText.bold': { en: 'Bold', ar: 'عريض' },
    'richText.italic': { en: 'Italic', ar: 'مائل' },
    'richText.underline': { en: 'Underline', ar: 'تسطير' },
    'richText.strikethrough': { en: 'Strikethrough', ar: 'يتوسطه خط' },
    'richText.code': { en: 'Code', ar: 'شيفرة' },
    'richText.addLink': { en: 'Add link', ar: 'إضافة رابط' },
    'richText.removeLink': { en: 'Remove link', ar: 'إزالة الرابط' },
    'richText.linkAddress': { en: 'Link address', ar: 'عنوان الرابط' },
    'richText.editLink': { en: 'Edit link', ar: 'تعديل الرابط' },
    'richText.saveLink': { en: 'Save link', ar: 'حفظ الرابط' },
    'richText.cancelLink': { en: 'Cancel', ar: 'إلغاء' },
    'richText.clearFormatting': { en: 'Clear formatting', ar: 'مسح التنسيق' },
    'richText.alignLeft': { en: 'Align left', ar: 'محاذاة لليسار' },
    'richText.alignCenter': { en: 'Align center', ar: 'توسيط' },
    'richText.alignRight': { en: 'Align right', ar: 'محاذاة لليمين' },
    'richText.justify': { en: 'Justify', ar: 'ضبط' },
    'richText.outdent': { en: 'Outdent', ar: 'إنقاص المسافة البادئة' },
    'richText.indent': { en: 'Indent', ar: 'زيادة المسافة البادئة' },
    'richText.unknownNode': {
      en: 'This text holds a "{type}" node this editor cannot draw, so it is shown as its words and cannot be changed here.',
      ar: 'يحتوي هذا النص على عقدة "{type}" لا يستطيع هذا المحرر رسمها، فيُعرض بكلماته ولا يمكن تغييره هنا.',
    },
    'richText.unreadable': {
      en: 'This editor cannot read this text, so it is shown as its words and cannot be changed here.',
      ar: 'لا يستطيع هذا المحرر قراءة هذا النص، فيُعرض بكلماته ولا يمكن تغييره هنا.',
    },
    'upload.choose': { en: 'Choose a file', ar: 'اختر ملفا' },
    'upload.add': { en: 'Add a file', ar: 'أضف ملفا' },
    'upload.new': { en: 'Upload new', ar: 'رفع ملف جديد' },
    'upload.file': { en: 'File', ar: 'الملف' },
    'upload.noFile': { en: 'No file chosen', ar: 'لم يُختر أي ملف' },
    'upload.required': { en: 'Choose a file first.', ar: 'اختر ملفا أولا.' },
    'upload.takes': { en: 'Files of these types, {size} at most: {types}.', ar: 'ملفات من هذه الأنواع، بحد أقصى {size}: {types}.' },
    'upload.send': { en: 'Upload', ar: 'رفع' },
    'upload.sending': { en: 'Uploading… {percent}%', ar: 'جارٍ الرفع… {percent}٪' },
    'upload.retry': { en: 'Try again', ar: 'أعد المحاولة' },
    'upload.missing': { en: 'This file cannot be shown.', ar: 'لا يمكن عرض هذا الملف.' },
    'upload.moveEarlier': { en: 'Move {name} earlier', ar: 'انقل {name} إلى السابق' },
    'upload.moveLater': { en: 'Move {name} later', ar: 'انقل {name} إلى التالي' },
    'upload.remove': { en: 'Remove {name}', ar: 'أزل {name}' },
    'upload.image': { en: 'Image', ar: 'صورة' },
    'upload.insert': { en: 'Insert an image', ar: 'إدراج صورة' },
    'upload.insertHint': { en: 'Choose a file already here, or upload a new one.', ar: 'اختر ملفا موجودا هنا، أو ارفع ملفا جديدا.' },
    time: { en: 'Time', ar: 'الوقت' },
    showOptions: { en: 'Show options', ar: 'إظهار الخيارات' },
    // base-ui names none of the combobox's icon-only buttons (`clear`, `showOptions`, `remove`), so a screen reader needs these.
    remove: { en: 'Remove', ar: 'إزالة' },
    andMore: { en: 'and {count} more', ar: 'و{count} أخرى' },
    noMatches: { en: 'No rows match this filter.', ar: 'لا توجد صفوف تطابق هذا المرشح.' },
    refused: { en: 'That list could not be read.', ar: 'تعذرت قراءة هذه القائمة.' },
    cannotSee: { en: 'You can\'t see this', ar: 'لا يمكنك رؤية هذا' },
    // A held id with no row: one a read of its kayan answered without, and one the viewer may not read.
    deleted: { en: 'Deleted', ar: 'محذوف' },
    notAvailable: { en: 'Not available', ar: 'غير متاح' },
    clearFilters: { en: 'Clear filters', ar: 'مسح المرشحات' },
    selectAll: { en: 'Select every row on this page', ar: 'حدد كل صف في هذه الصفحة' },
    selectRow: { en: 'Select this row', ar: 'حدد هذا الصف' },
    selected: { en: '{count} selected', ar: '{count} محدد' },
    actions: { en: 'Actions', ar: 'الإجراءات' },
    bulkWarning_one: { en: '{plural} you ticked: 1. This applies to it.', ar: 'حددت واحدا من {plural}، وينطبق هذا عليه.' },
    bulkWarning_two: { en: '{plural} you ticked: {count}. This applies to each of them.', ar: 'حددت اثنين من {plural}، وينطبق هذا عليهما.' },
    bulkWarning_few: { en: '{plural} you ticked: {count}. This applies to each of them.', ar: 'حددت {count} من {plural}، وينطبق هذا عليها كلها.' },
    bulkWarning_many: { en: '{plural} you ticked: {count}. This applies to each of them.', ar: 'حددت {count} من {plural}، وينطبق هذا عليها كلها.' },
    bulkWarning_other: { en: '{plural} you ticked: {count}. This applies to each of them.', ar: 'حددت {count} من {plural}، وينطبق هذا عليها كلها.' },
    bulkDone_one: { en: '{plural} done: 1.', ar: 'تم ذلك على واحد من {plural}.' },
    bulkDone_two: { en: '{plural} done: {count}.', ar: 'تم ذلك على اثنين من {plural}.' },
    bulkDone_few: { en: '{plural} done: {count}.', ar: 'تم ذلك على {count} من {plural}.' },
    bulkDone_many: { en: '{plural} done: {count}.', ar: 'تم ذلك على {count} من {plural}.' },
    bulkDone_other: { en: '{plural} done: {count}.', ar: 'تم ذلك على {count} من {plural}.' },
    leaveAsIs: { en: 'Leave as is', ar: 'اتركه كما هو' },
    bulkFilledOnly: { en: 'Only the fields you fill in change.', ar: 'تتغير الحقول التي تملؤها فقط.' },
    bulkNothingFilled: { en: 'Fill in at least one field.', ar: 'املأ حقلًا واحدًا على الأقل.' },
    bulkLeft_one: { en: '1 of the ticked rows was left as it is, because it has never been published.', ar: 'تُرك صف واحد محدد كما هو، لأنه لم يُنشر قط.' },
    bulkLeft_two: { en: '{count} of the ticked rows were left as they are, because they have never been published.', ar: 'تُرك صفان محددان كما هما، لأنهما لم يُنشرا قط.' },
    bulkLeft_few: { en: '{count} of the ticked rows were left as they are, because they have never been published.', ar: 'تُركت {count} صفوف محددة كما هي، لأنها لم تُنشر قط.' },
    bulkLeft_many: { en: '{count} of the ticked rows were left as they are, because they have never been published.', ar: 'تُرك {count} صفا محددا كما هي، لأنها لم تُنشر قط.' },
    bulkLeft_other: { en: '{count} of the ticked rows were left as they are, because they have never been published.', ar: 'تُرك {count} صف محدد كما هي، لأنها لم تُنشر قط.' },
    rowWarning: { en: 'This applies to this row.', ar: 'ينطبق هذا على هذا الصف.' },
    rowNamedWarning: { en: 'This applies to {name}.', ar: 'ينطبق هذا على {name}.' },
    noColumns: {
      en: 'Your role can\'t see any column of this list. Ask an administrator of your organization for access.',
      ar: 'لا يستطيع دورك رؤية أي عمود في هذه القائمة. اطلب الوصول من مدير مؤسستك.',
    },
    queryRefused: {
      en: 'This link asks the list for something it does not offer, so nothing was read.',
      ar: 'يطلب هذا الرابط من القائمة ما لا تقدمه، فلم يُقرأ شيء.',
    },
    permissions: { en: 'Permissions', ar: 'الصلاحيات' },
    record: { en: 'Record', ar: 'السجل' },
    invalidFields: { en: 'Fields needing attention: {count}', ar: 'حقول تحتاج إلى مراجعة: {count}' },
    errorSummary: { en: 'Check these fields:', ar: 'راجع هذه الحقول:' },
    addNew: { en: 'Add new {kind}', ar: 'إضافة {kind}' },
    backToList: { en: 'Back to list', ar: 'العودة إلى القائمة' },
    reload: { en: 'Reload', ar: 'إعادة التحميل' },
    hours: { en: 'Hours', ar: 'الساعات' },
    minutes: { en: 'Minutes', ar: 'الدقائق' },
    period: { en: 'AM or PM', ar: 'صباحا أو مساء' },
    organizations: { en: 'Organizations', ar: 'المؤسسات' },
    organization: { en: 'Organization', ar: 'مؤسسة' },
    noOrganization: { en: 'No organization', ar: 'لا توجد مؤسسة' },
    signOut: { en: 'Sign out', ar: 'تسجيل الخروج' },
    theme: { en: 'Toggle theme', ar: 'تبديل المظهر' },
    themeLight: { en: 'Light', ar: 'فاتح' },
    themeDark: { en: 'Dark', ar: 'داكن' },
    themeSystem: { en: 'System', ar: 'النظام' },
    // `toggleSidebar`: the primitive names itself in English alone, so an Arabic viewer hears English unless this is written.
    quickCreate: { en: 'Quick Create', ar: 'إنشاء سريع' },
    inbox: { en: 'Inbox', ar: 'صندوق الوارد' },
    documents: { en: 'Documents', ar: 'المستندات' },
    more: { en: 'More', ar: 'المزيد' },
    moreActions: { en: 'More actions', ar: 'إجراءات أخرى' },
    open: { en: 'Open', ar: 'فتح' },
    share: { en: 'Share', ar: 'مشاركة' },
    trash: { en: 'Move to Trash', ar: 'نقل إلى المهملات' },
    getHelp: { en: 'Get Help', ar: 'الحصول على مساعدة' },
    toggleSidebar: { en: 'Toggle Sidebar', ar: 'تبديل الشريط الجانبي' },
  },
  portal: {
    home: { en: 'Home', ar: 'الرئيسية' },
    welcome: { en: 'Welcome, {name}', ar: 'مرحبا، {name}' },
    about: { en: 'What you may open here, and how many of each you may read.', ar: 'ما يمكنك فتحه هنا، وعدد ما يمكنك قراءته من كل منها.' },
    open: { en: 'Open the list', ar: 'افتح القائمة' },
    // add-on: courses
    title: { en: 'Portal', ar: 'البوابة' },
    navigation: { en: 'Portal', ar: 'البوابة' },
    myEnrollments: { en: 'My enrollments', ar: 'تسجيلاتي' },
    'greeting.morning': { en: 'Good morning, {name}', ar: 'صباح الخير يا {name}' },
    'greeting.afternoon': { en: 'Good afternoon, {name}', ar: 'مساء الخير يا {name}' },
    'greeting.evening': { en: 'Good evening, {name}', ar: 'مساء الخير يا {name}' },
    yourNext: { en: 'Your next session', ar: 'جلستك القادمة' },
    startsIn: { en: 'Starts {when}', ar: 'تبدأ {when}' },
    viewCourse: { en: 'View course', ar: 'عرض الدورة' },
    canJoin: { en: 'Courses you can join', ar: 'دورات يمكنك الانضمام إليها' },
    seeAll: { en: 'See all courses', ar: 'كل الدورات' },
    noneToJoin: { en: 'No course has a session coming up just now.', ar: 'لا توجد دورة لها جلسة قادمة الآن.' },
    search: { en: 'Search courses', ar: 'ابحث في الدورات' },
    byTag: { en: 'Filter by tag', ar: 'التصفية حسب الوسم' },
    allTags: { en: 'All', ar: 'الكل' },
    noMatch: { en: 'No course matches.', ar: 'لا توجد دورة مطابقة.' },
    next: { en: 'Next session', ar: 'الجلسة القادمة' },
    noSession: { en: 'No session scheduled yet', ar: 'لا توجد جلسة مجدولة بعد' },
    free: { en: 'Free', ar: 'مجانا' },
    perSeat: { en: 'per seat', ar: 'لكل مقعد' },
    back: { en: 'Back to courses', ar: 'العودة إلى الدورات' },
    aboutCourse: { en: 'About this course', ar: 'عن هذه الدورة' },
    choose: { en: 'Choose a session', ar: 'اختر جلسة' },
    full: { en: 'Full', ar: 'مكتملة' },
    seatsLeft_zero: { en: '{count} seats left', ar: 'لم يبق أي مقعد' },
    seatsLeft_one: { en: '{count} seat left', ar: 'بقي مقعد واحد' },
    seatsLeft_two: { en: '{count} seats left', ar: 'بقي مقعدان' },
    seatsLeft_few: { en: '{count} seats left', ar: 'بقيت {count} مقاعد' },
    seatsLeft_many: { en: '{count} seats left', ar: 'بقي {count} مقعدا' },
    seatsLeft_other: { en: '{count} seats left', ar: 'بقي {count} مقعد' },
    total: { en: 'Total', ar: 'الإجمالي' },
    pick: { en: 'Pick a session', ar: 'اختر جلسة' },
    enrollIn: { en: 'Enroll on {when}', ar: 'سجّلني في {when}' },
    enrolled: { en: 'You are enrolled.', ar: 'تم تسجيلك.' },
    enrollFailed: { en: 'The seat was not taken. Please try again.', ar: 'لم يُحجز المقعد. حاول مرة أخرى.' },
    holding: { en: 'You hold a seat on {when}.', ar: 'لك مقعد في {when}.' },
    askSchool: { en: 'Ask your school to enroll you.', ar: 'اطلب من مدرستك تسجيلك.' },
    upcoming: { en: 'Upcoming', ar: 'القادمة' },
    past: { en: 'Past', ar: 'السابقة' },
    noneUpcoming: { en: 'No session to come.', ar: 'لا توجد جلسة قادمة.' },
    nonePast: { en: 'No past session.', ar: 'لا توجد جلسة سابقة.' },
    course: { en: 'Course', ar: 'الدورة' },
    place: { en: 'Venue and format', ar: 'المكان والصيغة' },
    leave: { en: 'Cancel enrollment', ar: 'إلغاء التسجيل' },
    leaveTitle: { en: 'Cancel this enrollment?', ar: 'إلغاء هذا التسجيل؟' },
    leaveBody: { en: 'Your seat goes back to the session, and someone else may take it.', ar: 'يعود مقعدك إلى الجلسة، وقد يأخذه غيرك.' },
    keep: { en: 'Keep it', ar: 'أبقِه' },
    left: { en: 'Your enrollment is cancelled.', ar: 'أُلغي تسجيلك.' },
    leaveFailed: { en: 'The enrollment was not cancelled. Please try again.', ar: 'لم يُلغَ التسجيل. حاول مرة أخرى.' },
    failed: { en: 'This could not be read just now.', ar: 'تعذرت قراءة هذا الآن.' },
    retry: { en: 'Try again', ar: 'حاول مرة أخرى' },
    // end add-on: courses
    // add-on: courses, settings
    closed: { en: 'Closed for maintenance', ar: 'مغلقة للصيانة' },
    closedBody: { en: 'The school is working on the portal. Please come back soon.', ar: 'تعمل المدرسة على البوابة. عد قريبا من فضلك.' },
    contact: { en: 'Questions? Write to', ar: 'لديك سؤال؟ راسل' },
    // end add-on: courses, settings
  },
  auth: {
    signIn: { en: 'Sign in', ar: 'تسجيل الدخول' },
    signInDescription: { en: 'Welcome back. Sign in with your email and password.', ar: 'مرحبا بعودتك. سجّل الدخول ببريدك الإلكتروني وكلمة المرور.' },
    signInBackofficeDescription: { en: 'Sign in to reach the backoffice.', ar: 'سجل الدخول للوصول إلى لوحة الإدارة الخلفية.' },
    signInPending: { en: 'Signing in…', ar: 'جارٍ تسجيل الدخول…' },
    createFirstUser: { en: 'Create the first administrator', ar: 'إنشاء أول مسؤول' },
    createFirstUserDescription: {
      en: 'No one administers this backoffice yet. The account made here becomes its first administrator.',
      ar: 'لا أحد يدير لوحة الإدارة الخلفية هذه بعد. الحساب الذي يُنشأ هنا يصبح أول مسؤول عنها.',
    },
    createFirstUserSubmit: { en: 'Create the administrator', ar: 'إنشاء المسؤول' },
    createFirstUserPending: { en: 'Creating…', ar: 'جارٍ الإنشاء…' },
    createFirstUserFailed: { en: 'That administrator could not be created.', ar: 'تعذر إنشاء هذا المسؤول.' },
    setupCode: { en: 'Setup code', ar: 'رمز الإعداد' },
    setupCodeDescription: { en: 'The SETUP_CODE this server was started with.', ar: 'قيمة SETUP_CODE التي شُغّل بها هذا الخادم.' },
    setupCodeWrong: { en: 'That is not the setup code.', ar: 'هذا ليس رمز الإعداد.' },
    setupCodeUnset: {
      en: 'The first administrator is made only with a setup code, and this server has none it can use: SETUP_CODE is unset or shorter than 32 characters. Set SETUP_CODE where the backoffice app runs to a random value of 32 characters or more, restart it, and open this page again.',
      ar: 'لا يُنشأ أول مسؤول إلا برمز إعداد، وليس لدى هذا الخادم رمز يمكنه استعماله: SETUP_CODE غير مضبوط أو أقصر من 32 حرفا. اضبط SETUP_CODE حيث يعمل تطبيق لوحة الإدارة الخلفية على قيمة عشوائية من 32 حرفا أو أكثر، ثم أعد تشغيله وافتح هذه الصفحة مرة أخرى.',
    },
    firstRegisterClosed: {
      en: 'This backoffice has its administrator, so this page is closed. Sign in instead.',
      ar: 'للوحة الإدارة الخلفية هذه مسؤولها، لذا أُغلقت هذه الصفحة. سجل الدخول بدلا من ذلك.',
    },
    firstRun: { en: 'Set up this app', ar: 'إعداد هذا التطبيق' },
    firstRunDescription: {
      en: 'Nobody owns this app yet. The account made here becomes its owner and first administrator.',
      ar: 'لا أحد يملك هذا التطبيق بعد. الحساب الذي يُنشأ هنا يصبح مالكه وأول مسؤول عنه.',
    },
    firstRunSubmit: { en: 'Set up the app', ar: 'إعداد التطبيق' },
    firstRunCodeUnset: {
      en: 'This app is set up only with a setup code, and this server has none it can use: SETUP_CODE is unset or shorter than 32 characters. Set SETUP_CODE where the app runs to a random value of 32 characters or more, restart it, and open this page again.',
      ar: 'لا يُعدّ هذا التطبيق إلا برمز إعداد، وليس لدى هذا الخادم رمز يمكنه استعماله: SETUP_CODE غير مضبوط أو أقصر من 32 حرفا. اضبط SETUP_CODE حيث يعمل التطبيق على قيمة عشوائية من 32 حرفا أو أكثر، ثم أعد تشغيله وافتح هذه الصفحة مرة أخرى.',
    },
    firstRunPending: { en: 'Setting up…', ar: 'جارٍ الإعداد…' },
    firstRunFailed: { en: 'That owner could not be made.', ar: 'تعذر إنشاء هذا المالك.' },
    firstRunClosed: { en: 'This app has its owner, so this page is closed. Sign in instead.', ar: 'لهذا التطبيق مالكه، لذا أُغلقت هذه الصفحة. سجل الدخول بدلا من ذلك.' },
    setupPending: { en: 'This app is not set up yet. Its administrator sets it up first.', ar: 'لم يُعدّ هذا التطبيق بعد. يُعدّه مسؤوله أولا.' },
    inviteOnly: {
      en: 'Accounts here are made by invitation. Open the link of the invitation sent to you, or sign in.',
      ar: 'تُنشأ الحسابات هنا بدعوة. افتح رابط الدعوة المرسلة إليك، أو سجل الدخول.',
    },
    outsideDomains: { en: 'This email address is not at a domain that may sign up here.', ar: 'هذا البريد الإلكتروني ليس من نطاق يُسمح له بإنشاء حساب هنا.' },
    verifySent: { en: 'Check your email', ar: 'تحقق من بريدك الإلكتروني' },
    verifySentDescription: {
      en: 'We sent a link to {email}. Open it to confirm your address and choose your password; it signs you in. It lasts an hour.',
      ar: 'أرسلنا رابطا إلى {email}. افتحه لتأكيد عنوانك واختيار كلمة المرور، فتدخل به مباشرة. وهو صالح ساعة.',
    },
    failed: { en: 'That sign-in did not work.', ar: 'لم ينجح تسجيل الدخول.' },
    signUp: { en: 'Sign up', ar: 'إنشاء حساب' },
    signUpDescription: { en: 'Make an account.', ar: 'أنشئ حسابا.' },
    signUpPending: { en: 'Signing up…', ar: 'جارٍ إنشاء الحساب…' },
    signUpFailed: { en: 'That sign-up did not work.', ar: 'لم ينجح إنشاء الحساب.' },
    organizationFailed: { en: 'That organization could not be created.', ar: 'تعذر إنشاء هذه المؤسسة.' },
    name: { en: 'Name', ar: 'الاسم' },
    organization: { en: 'Organization', ar: 'المؤسسة' },
    email: { en: 'Email', ar: 'البريد الإلكتروني' },
    password: { en: 'Password', ar: 'كلمة المرور' },
    confirmPassword: { en: 'Confirm the password', ar: 'أكد كلمة المرور' },
    passwordsDiffer: { en: 'The two passwords are not the same.', ar: 'كلمتا المرور غير متطابقتين.' },
    required: { en: 'This field is required.', ar: 'هذا الحقل مطلوب.' },
    invalidEmail: { en: 'Invalid email', ar: 'بريد إلكتروني غير صالح' },
    passwordTooShort: { en: 'Password too short', ar: 'كلمة المرور قصيرة جدا' },
    passwordTooLong: { en: 'Password too long', ar: 'كلمة المرور طويلة جدا' },
    passwordRule: { en: 'At least {count} characters.', ar: '{count} أحرف على الأقل.' },
    showPassword: { en: 'Show password', ar: 'إظهار كلمة المرور' },
    forgotPasswordQuestion: { en: 'Forgot password?', ar: 'هل نسيت كلمة المرور؟' },
    askAdministrator: { en: 'Ask your administrator for a password link.', ar: 'اطلب من مسؤولك رابطا لكلمة المرور.' },
    forgotPassword: { en: 'Forgot password', ar: 'نسيت كلمة المرور' },
    forgotPasswordInstructions: {
      en: 'Please enter your email below. You will receive an email message with instructions on how to reset your password.',
      ar: 'أدخل بريدك الإلكتروني أدناه. ستصلك رسالة بريد إلكتروني فيها تعليمات إعادة تعيين كلمة المرور.',
    },
    submit: { en: 'Submit', ar: 'إرسال' },
    emailSent: { en: 'Email sent', ar: 'تم إرسال البريد الإلكتروني' },
    checkYourEmail: {
      en: "If the email address is associated with an account, you will receive instructions to reset your password shortly. Please check your spam or junk mail folder if you don't see the email in your inbox.",
      ar: 'إذا كان هذا البريد الإلكتروني مرتبطا بحساب، فستصلك قريبا تعليمات إعادة تعيين كلمة المرور. إذا لم تجد الرسالة في صندوق الوارد، فتحقق من مجلد البريد العشوائي أو غير المرغوب فيه.',
    },
    noMailer: {
      en: 'If no email arrives, ask your administrator for a password link.',
      ar: 'إذا لم يصلك بريد، فاطلب من مسؤولك رابطا لكلمة المرور.',
    },
    backToSignIn: { en: 'Back to login', ar: 'العودة إلى تسجيل الدخول' },
    resetPassword: { en: 'Reset password', ar: 'إعادة تعيين كلمة المرور' },
    setPassword: { en: 'Choose your password', ar: 'اختر كلمة المرور' },
    organizationNameIn: { en: 'Its name in {language}, if it has one', ar: 'اسمها بـ{language}، إن كان لها اسم بها' },
    setPasswordSubmit: { en: 'Confirm and set password', ar: 'أكّد واحفظ كلمة المرور' },
    passwordChosen: { en: 'Your address is confirmed and your password is set. Sign in with it.', ar: 'تأكّد عنوانك وحُفظت كلمة المرور. سجّل الدخول بها.' },
    newPassword: { en: 'New password', ar: 'كلمة مرور جديدة' },
    passwordReset: { en: 'Password reset successfully.', ar: 'تمت إعادة تعيين كلمة المرور بنجاح.' },
    tokenInvalid: { en: 'Token is either invalid or has expired.', ar: 'الرمز غير صالح أو انتهت صلاحيته.' },
    alreadySignedIn: { en: 'You are already signed in', ar: 'سجلت الدخول بالفعل' },
    backTo: { en: 'Back to {screen}', ar: 'العودة إلى {screen}' },
    continue: { en: 'Continue', ar: 'متابعة' },
    resetDisabled: {
      en: 'Password reset is not available. Ask your administrator to reset your password.',
      ar: 'إعادة تعيين كلمة المرور غير متاحة. اطلب من المسؤول إعادة تعيين كلمة المرور الخاصة بك.',
    },
    tooManyRequests: { en: 'Too many attempts. Wait a moment and try again.', ar: 'محاولات كثيرة جدا. انتظر قليلا ثم حاول مرة أخرى.' },
    invalidCredentials: { en: 'The email or password provided is incorrect.', ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
    emailNotVerified: {
      en: 'This email address is not confirmed yet. Open the link we sent to it, or ask for a password reset to get a new one.',
      ar: 'لم يُؤكَّد هذا البريد الإلكتروني بعد. افتح الرابط الذي أرسلناه إليه، أو اطلب إعادة تعيين كلمة المرور لتحصل على رابط جديد.',
    },
    banned: { en: 'This account is banned, so it cannot sign in.', ar: 'هذا الحساب محظور، لذا لا يمكنه تسجيل الدخول.' },
    userExists: { en: 'An account with this email already exists. Use another email.', ar: 'يوجد حساب بهذا البريد الإلكتروني. استخدم بريدا آخر.' },
    requestFailed: { en: 'That request did not work.', ar: 'لم ينجح هذا الطلب.' },
    resetFailed: { en: 'That reset did not work.', ar: 'لم تنجح إعادة التعيين.' },
    noAccount: { en: 'No account yet?', ar: 'لا يوجد حساب بعد؟' },
    invitation: { en: 'Invitation', ar: 'دعوة' },
    invitationSignedOut: {
      en: 'Sign in, or make an account with the email address the invitation was sent to, to accept it.',
      ar: 'سجل الدخول، أو أنشئ حسابا بالبريد الإلكتروني الذي أُرسلت إليه الدعوة، لتقبلها.',
    },
    invitationReading: { en: 'Reading the invitation…', ar: 'جارٍ قراءة الدعوة…' },
    invitationJoin: { en: 'You are invited to join {organization}.', ar: 'أنت مدعو للانضمام إلى {organization}.' },
    invitationAccept: { en: 'Accept the invitation', ar: 'قبول الدعوة' },
    invitationAccepting: { en: 'Accepting…', ar: 'جارٍ القبول…' },
    invitationAcceptFailed: { en: 'That invitation could not be accepted.', ar: 'تعذر قبول هذه الدعوة.' },
    invitationMissing: { en: 'This link names no invitation.', ar: 'هذا الرابط لا يشير إلى أي دعوة.' },
    invitationInviterGone: {
      en: 'Whoever sent this invitation is no longer a member of the organization, so it cannot be accepted. Ask a member to invite you again.',
      ar: 'من أرسل هذه الدعوة لم يعد عضوا في المؤسسة، لذا لا يمكن قبولها. اطلب من أحد الأعضاء أن يدعوك مرة أخرى.',
    },
    invitationGone: {
      en: 'This invitation has expired, was cancelled or was already accepted. Ask whoever invited you to send a new one.',
      ar: 'انتهت صلاحية هذه الدعوة أو أُلغيت أو قُبلت من قبل. اطلب ممن دعاك أن يرسل دعوة جديدة.',
    },
    invitationNotYours: {
      en: 'This invitation was sent to another email address. Sign out, then sign in with that address to accept it.',
      ar: 'أُرسلت هذه الدعوة إلى بريد إلكتروني آخر. سجل الخروج، ثم سجل الدخول بذلك البريد لقبولها.',
    },
    signUpInvitedDescription: {
      en: 'Make an account with the email address the invitation was sent to.',
      ar: 'أنشئ حسابا بالبريد الإلكتروني الذي أُرسلت إليه الدعوة.',
    },
    haveAccount: { en: 'Already have an account?', ar: 'لديك حساب بالفعل؟' },
    unauthorized: { en: 'Choose where to go', ar: 'اختر وجهتك' },
    unauthorizedDescription: { en: 'This page isn\'t part of your account. Where would you like to go?', ar: 'هذه الصفحة ليست ضمن حسابك. إلى أين تريد الذهاب؟' },
    unauthorizedPage: { en: 'Your role does not open that page: {page}.', ar: 'دورك لا يفتح تلك الصفحة: {page}.' },
    noAccess: { en: 'Your account has no access yet', ar: 'لا يملك حسابك أي وصول بعد' },
    noAccessDescription: {
      en: '{email} is a member of {organization} and holds no role that opens a screen here. Ask an administrator of {organization} to give you one.',
      ar: '{email} عضو في {organization} ولا يملك دورا يفتح أي شاشة هنا. اطلب من أحد مسؤولي {organization} أن يمنحك دورا.',
    },
    switchTo: { en: 'Switch to {organization}', ar: 'التبديل إلى {organization}' },
    accountStatus: { en: 'See your account status', ar: 'اطّلع على حالة حسابك' },
    noOrganization: { en: '{email} belongs to no organization yet.', ar: '{email} لا ينتمي إلى أي مؤسسة بعد.' },
    yourInvitations: { en: 'Your invitations', ar: 'دعواتك' },
    invitationDecline: { en: 'Decline', ar: 'رفض' },
    createOrganization: { en: 'Create an organization', ar: 'أنشئ مؤسسة' },
    createOrganizationSubmit: { en: 'Create', ar: 'إنشاء' },
    workspaceOf: { en: '{name}\'s workspace', ar: 'مساحة عمل {name}' },
    askToBeInvited: { en: 'Ask an administrator to invite {email}.', ar: 'اطلب من أحد المسؤولين أن يدعو {email}.' },
  },
  marketing: {
    brand: { en: 'Asas', ar: 'أساس' },
    getStarted: { en: 'Get started', ar: 'ابدأ الآن' },
    openScreen: { en: 'Open {screen}', ar: 'افتح {screen}' },
    heroTitle: { en: 'Run your organization without the busywork', ar: 'أدر مؤسستك دون العمل الروتيني' },
    heroSubtitle: {
      en: 'Asas is a dashboard and a portal for organizations: keep your records in one place, and keep every role to what it should see.',
      ar: 'أساس لوحة تحكم وبوابة للمؤسسات: احفظ سجلاتك في مكان واحد، واحصر كل دور بما ينبغي أن يراه.',
    },
    featuresTitle: { en: 'Everything an organization needs', ar: 'كل ما تحتاجه مؤسسة' },
    featuresSubtitle: {
      en: 'One system for your records, from the first entry to who may see it.',
      ar: 'نظام واحد لسجلاتك، من أول إدخال إلى من يحق له رؤيته.',
    },
    featureRolesTitle: { en: 'Roles and permissions', ar: 'الأدوار والصلاحيات' },
    featureRolesDescription: {
      en: 'Each organization sets its own roles, and every screen, field and action follows what a role may read or write.',
      ar: 'تحدد كل مؤسسة أدوارها الخاصة، وتتبع كل شاشة وحقل وإجراء ما يحق للدور قراءته أو تعديله.',
    },
    featureBilingualTitle: { en: 'Arabic and English, either direction', ar: 'العربية والإنجليزية، بكلا الاتجاهين' },
    featureBilingualDescription: {
      en: 'Every screen and every label is written in both languages, and the layout mirrors correctly under Arabic.',
      ar: 'كل شاشة وكل تسمية مكتوبة باللغتين، ويُعكس التخطيط بشكل صحيح تحت العربية.',
    },
    featurePortalTitle: { en: 'A dashboard and a customer portal', ar: 'لوحة تحكم وبوابة للعملاء' },
    featurePortalDescription: {
      en: 'Staff work from the dashboard; customers see their own shorter view of the same data in the portal.',
      ar: 'يعمل الموظفون من لوحة التحكم؛ ويرى العملاء نسختهم المختصرة من البيانات نفسها في البوابة.',
    },
    howTitle: { en: 'How it works', ar: 'كيف يعمل' },
    howStep1Title: { en: 'Set up your organization', ar: 'أنشئ مؤسستك' },
    howStep1Description: { en: 'Sign up and create your organization in one step.', ar: 'أنشئ حسابك ومؤسستك في خطوة واحدة.' },
    howStep2Title: { en: 'Add your records and roles', ar: 'أضف سجلاتك وأدوارك' },
    howStep2Description: {
      en: 'List what your organization keeps and decide what each role may do.',
      ar: 'أدرج ما تحفظه مؤسستك وحدد ما يحق لكل دور القيام به.',
    },
    howStep3Title: { en: 'Open the portal to your customers', ar: 'افتح البوابة لعملائك' },
    howStep3Description: {
      en: 'Customers sign in to their own portal to see what is theirs.',
      ar: 'يسجل العملاء الدخول إلى بوابتهم الخاصة لرؤية ما يخصهم.',
    },
    ctaTitle: { en: 'Start running your organization on Asas', ar: 'ابدأ بإدارة مؤسستك على أساس' },
    ctaSubtitle: { en: 'Create your organization and add your first record in minutes.', ar: 'أنشئ مؤسستك وأضف أول سجل لك خلال دقائق.' },
    footer: { en: 'Asas — one place for an organization\'s records.', ar: 'أساس — مكان واحد لسجلات المؤسسة.' },
  },
  dashboard: {
    dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
    openBackoffice: { en: 'Open the backoffice', ar: 'فتح لوحة الإدارة الخلفية' },
    members: { en: 'Members', ar: 'الأعضاء' },
    membersAbout: { en: 'Who works in this organization, and the role each holds.', ar: 'من يعمل في هذه المؤسسة، والدور الذي يشغله كل منهم.' },
    membersRoles: { en: 'Roles', ar: 'الأدوار' },
    membersName: { en: 'Name', ar: 'الاسم' },
    membersEmail: { en: 'Email', ar: 'البريد الإلكتروني' },
    membersJoined: { en: 'Joined', ar: 'تاريخ الانضمام' },
    membersNone: { en: 'No one works in this organization yet.', ar: 'لا يعمل أحد في هذه المؤسسة بعد.' },
    invite: { en: 'Invite', ar: 'دعوة' },
    addPerson: { en: 'Add person', ar: 'إضافة شخص' },
    addPersonTitle: { en: 'Add a person', ar: 'إضافة شخص' },
    addPersonAbout: {
      en: 'They get an account here and a link to choose their password. Someone who already has an account is sent an invitation instead.',
      ar: 'يحصل على حساب هنا ورابط لاختيار كلمة مروره. ومن لديه حساب بالفعل تُرسل إليه دعوة بدلا من ذلك.',
    },
    addPersonRole: { en: 'Role', ar: 'الدور' },
    addPersonNoRole: { en: 'No role yet', ar: 'بلا دور بعد' },
    addPersonSubmit: { en: 'Add', ar: 'إضافة' },
    addPersonLink: {
      en: 'Hand this link to them alone: it chooses their password and lasts 24 hours.',
      ar: 'سلّم هذا الرابط له وحده: به يختار كلمة مروره، وهو صالح 24 ساعة.',
    },
    addPersonRefused: { en: 'The server refused to add that person.', ar: 'رفض الخادم إضافة هذا الشخص.' },
    inviteTitle: { en: 'Invite someone', ar: 'دعوة شخص' },
    inviteAbout: {
      en: 'They join this organization as a member once they accept. Give them roles here after that.',
      ar: 'ينضم إلى هذه المؤسسة عضوًا بعد أن يقبل الدعوة. امنحه الأدوار هنا بعد ذلك.',
    },
    inviteSend: { en: 'Send invitation', ar: 'إرسال الدعوة' },
    inviteRefused: { en: 'The server refused that invitation.', ar: 'رفض الخادم هذه الدعوة.' },
    inviteSent: { en: 'Invitation sent to {email}', ar: 'أُرسلت الدعوة إلى {email}' },
    inviteCancelled: { en: 'Invitation cancelled', ar: 'أُلغيت الدعوة' },
    rolesSaved: { en: 'Roles saved for {name}', ar: 'حُفظت أدوار {name}' },
    memberRemoved: { en: '{name} removed', ar: 'أُزيل {name}' },
    personAdded: { en: '{name} added. A link to choose a password was sent to {email}.', ar: 'أُضيف {name}. أُرسل إلى {email} رابط لاختيار كلمة المرور.' },
    personAddedLink: { en: '{name} added. Hand them the link below.', ar: 'أُضيف {name}. سلّمه الرابط أدناه.' },
    inviteAlreadyMember: { en: 'This person is already a member of this organization.', ar: 'هذا الشخص عضو في هذه المؤسسة بالفعل.' },
    inviteAlreadyInvited: { en: 'This person already has an invitation that is not yet accepted.', ar: 'لدى هذا الشخص دعوة لم تُقبل بعد.' },
    inviteNotAllowed: { en: 'You may not invite people to this organization.', ar: 'لا يحق لك دعوة أشخاص إلى هذه المؤسسة.' },
    inviteNoMailer: {
      en: 'Each pending invitation has a link to copy and share privately.',
      ar: 'لكل دعوة معلقة رابط يمكنك نسخه ومشاركته مع صاحب الدعوة وحده.',
    },
    inviteCopy: { en: 'Copy link', ar: 'نسخ الرابط' },
    link: { en: 'Link', ar: 'الرابط' },
    inviteLinkOwn: {
      en: 'A copied link lets whoever holds it join as the invited address: hand it to that person alone.',
      ar: 'الرابط المنسوخ يتيح لمن يحمله الانضمام بالعنوان المدعو: سلّمه لذلك الشخص وحده.',
    },
    inviteCopied: { en: 'Link copied', ar: 'تم نسخ الرابط' },
    inviteCancel: { en: 'Cancel invitation', ar: 'إلغاء الدعوة' },
    inviteCancelRefused: { en: 'The server refused to cancel that invitation.', ar: 'رفض الخادم إلغاء هذه الدعوة.' },
    inviteCancelNotAllowed: { en: 'You may not cancel this invitation.', ar: 'لا يحق لك إلغاء هذه الدعوة.' },
    removeMember: { en: 'Remove from organization', ar: 'إزالة من المؤسسة' },
    removeAbout: {
      en: 'They lose access to this organization and every role they hold in it. Inviting them again does not give the roles back.',
      ar: 'يفقد هذا العضو الوصول إلى هذه المؤسسة وكل الأدوار التي يشغلها فيها. دعوته مرة أخرى لا تعيد إليه أدواره.',
    },
    removeConfirm: { en: 'Remove for good', ar: 'إزالة نهائيا' },
    removeKeep: { en: 'Keep this member', ar: 'إبقاء هذا العضو' },
    removeRefused: { en: 'The server refused to remove that member.', ar: 'رفض الخادم إزالة هذا العضو.' },
    removeLastOwner: { en: 'The organization\'s only owner cannot be removed.', ar: 'لا يمكن إزالة المالك الوحيد للمؤسسة.' },
    removeNotAllowed: { en: 'You may not remove members of this organization.', ar: 'لا يحق لك إزالة أعضاء هذه المؤسسة.' },
    rolesHolderUnnamed: { en: 'A member', ar: 'أحد الأعضاء' },
    invitationsTab: { en: 'Invitations ({count})', ar: 'الدعوات ({count})' },
    invitesNone: { en: 'No invitation is waiting to be accepted.', ar: 'لا توجد دعوة تنتظر القبول.' },
    inviteByLink: { en: 'Invite by link', ar: 'الدعوة برابط' },
    inviteSentBy: { en: 'Sent by', ar: 'أرسلها' },
    inviteExpired: { en: 'Expired', ar: 'منتهية' },
    inviteResend: { en: 'Resend', ar: 'إعادة الإرسال' },
    inviteResent: { en: 'Invitation sent again to {email}', ar: 'أُعيد إرسال الدعوة إلى {email}' },
    membersRoleFilter: { en: 'Role', ar: 'الدور' },
    membersEveryRole: { en: 'Every role', ar: 'كل الأدوار' },
    membersNotGrantable: {
      en: 'It grants keys you do not hold, so only someone who holds them gives or takes it.',
      ar: 'يمنح صلاحيات لا تملكها، لذا لا يمنحه أو يسحبه إلا من يملكها.',
    },
    passwordLinkEmailFailed: { en: 'Email could not be sent. Copy or share this link instead.', ar: 'تعذر إرسال البريد. انسخ الرابط أو شاركه.' },
    passwordLinkWhatsApp: { en: 'Send by WhatsApp', ar: 'إرسال عبر واتساب' },
    passwordLinkCancel: { en: 'Cancel link', ar: 'إلغاء الرابط' },
    passwordLinkCancelled: { en: 'Link cancelled', ar: 'أُلغي الرابط' },
    passwordLinkMessage: { en: 'Choose your password using this one-time link:', ar: 'اختر كلمة مرورك بهذا الرابط الذي يستخدم مرة واحدة:' },
    passwordLinkPrivate: { en: 'Share this link with this person alone. It chooses their password and works once.', ar: 'شارك الرابط مع هذا الشخص وحده. يختار به كلمة مروره ويستخدم مرة واحدة.' },
    passwordLink: { en: 'Send a new password link', ar: 'إرسال رابط جديد لكلمة المرور' },
    passwordLinkSent: { en: 'A link to choose a password was sent to {email}', ar: 'أُرسل إلى {email} رابط لاختيار كلمة المرور' },
    passwordLinkRefused: { en: 'The server refused to send that link.', ar: 'رفض الخادم إرسال هذا الرابط.' },
    passwordLinkHanded: {
      en: 'Hand this link to {name} alone: it chooses their password and lasts 24 hours.',
      ar: 'سلّم هذا الرابط إلى {name} وحده: به يختار كلمة مروره، وهو صالح 24 ساعة.',
    },
    removeTitle: { en: 'Remove {name}?', ar: 'إزالة {name}؟' },
    inviteExpires: { en: 'Expires', ar: 'تنتهي في' },
    membersFixed: { en: 'Fixed roles', ar: 'الأدوار الثابتة' },
    membersCustom: { en: 'Custom roles', ar: 'الأدوار المخصصة' },
    membersNoRoles: { en: 'There is no role you may read to assign.', ar: 'لا يوجد دور يمكنك قراءته لإسناده.' },
    membersRefused: { en: 'The server refused that change.', ar: 'رفض الخادم هذا التغيير.' },
    everyPermission: { en: 'Every permission', ar: 'كل الصلاحيات' },
    rolesAbout: {
      en: 'Fixed roles ship with the project and cannot be changed here. Custom roles are this organization\'s own.',
      ar: 'الأدوار الثابتة تأتي مع المشروع ولا يمكن تغييرها هنا. الأدوار المخصصة خاصة بهذه المؤسسة.',
    },
    rolesNew: { en: 'New role', ar: 'دور جديد' },
    rolesKind: { en: 'Kind', ar: 'النوع' },
    rolesFixed: { en: 'Fixed', ar: 'ثابت' },
    rolesCustom: { en: 'Custom', ar: 'مخصص' },
    rolesOpen: { en: 'Open {role}', ar: 'فتح {role}' },
    rolesFixedAbout: {
      en: 'This role ships with the project. What it holds is code, so it cannot be edited or deleted here.',
      ar: 'يأتي هذا الدور مع المشروع. ما يمنحه مكتوب في الشيفرة، لذا لا يمكن تعديله أو حذفه هنا.',
    },
    rolesDeleteTitle: { en: 'Delete this role?', ar: 'حذف هذا الدور؟' },
    rolesHeldTitle: { en: 'Members hold this role', ar: 'أعضاء يشغلون هذا الدور' },
    rolesHeld: {
      en: 'A role a member holds is not deleted. Take it from each of them on the Members page first.',
      ar: 'لا يُحذف دور يشغله عضو. اسحبه من كل منهم في صفحة الأعضاء أولا.',
    },
    rolesCountsFailed: { en: 'Member counts could not be loaded.', ar: 'تعذر تحميل أعداد الأعضاء.' },
    permissionsScreens: { en: 'Screens', ar: 'الشاشات' },
    permissionsFields: { en: 'Fields', ar: 'الحقول' },
    permissionsCount: { en: '{count} permissions', ar: 'الصلاحيات: {count}' },
    permissionsCountOne: { en: '1 permission', ar: 'صلاحية واحدة' },
    permissionsOther: { en: 'Other', ar: 'أخرى' },
    permissionsRequired: { en: 'Permissions, required', ar: 'الصلاحيات، مطلوبة' },
    membersOwnRole: {
      en: 'This role lets you manage roles, so only another member who may manage roles takes it from you.',
      ar: 'هذا الدور يتيح لك إدارة الأدوار، لذا لا يسحبه منك إلا عضو آخر يملك إدارة الأدوار.',
    },
    membersOwnerRole: {
      en: 'The owner of the organization always holds this role.',
      ar: 'مالك المؤسسة يشغل هذا الدور دائما.',
    },
    dashboardAbout: { en: 'What this organization holds, and how many have enrolled lately.', ar: 'ما تضمه هذه المؤسسة، وعدد من سجلوا مؤخرا.' },
    dashboardAboutCatalogue: { en: 'What this organization holds.', ar: 'ما تضمه هذه المؤسسة.' },
    kpiCourses: { en: 'Courses', ar: 'الدورات' },
    kpiCoursesOpen: { en: '{count} not archived', ar: 'غير المؤرشفة: {count}' },
    kpiFees: { en: 'Total fees', ar: 'مجموع الرسوم' },
    kpiFeesFooter: { en: 'The fee of every course not archived, summed per currency', ar: 'رسوم كل دورة غير مؤرشفة، مجموعة لكل عملة' },
    kpiEnrollments: { en: 'Enrollments', ar: 'التسجيلات' },
    kpiAllTime: { en: 'Since the first one', ar: 'منذ أول تسجيل' },
    kpiRecent: { en: 'New enrollments', ar: 'التسجيلات الجديدة' },
    kpiInRange_few: { en: 'In the last {count} days', ar: 'خلال آخر {count} أيام' },
    kpiInRange_many: { en: 'In the last {count} days', ar: 'خلال آخر {count} يومًا' },
    kpiInRange_other: { en: 'In the last {count} days', ar: 'خلال آخر {count} يوم' },
    chartEnrollments: { en: 'Enrollments per day', ar: 'التسجيلات في كل يوم' },
    chartDays_few: { en: '{count} days', ar: '{count} أيام' },
    chartDays_many: { en: '{count} days', ar: '{count} يومًا' },
    chartDays_other: { en: '{count} days', ar: '{count} يوم' },
    upcoming: { en: 'Upcoming sessions', ar: 'الجلسات القادمة' },
    upcomingAbout: { en: 'The next sessions to start, soonest first.', ar: 'الجلسات التالية التي ستبدأ، الأقرب أولا.' },
    upcomingNone: { en: 'No session is about to start.', ar: 'لا توجد جلسة على وشك البدء.' },
  },
  permissions: {
    find: { en: 'List', ar: 'عرض القائمة' },
    findByID: { en: 'View', ar: 'عرض' },
    findOne: { en: 'View', ar: 'عرض' },
    count: { en: 'Count', ar: 'العد' },
    create: { en: 'Create', ar: 'إنشاء' },
    update: { en: 'Edit', ar: 'تعديل' },
    delete: { en: 'Delete', ar: 'حذف' },
    updateMany: { en: 'Edit many', ar: 'تعديل عدة سجلات' },
    deleteMany: { en: 'Delete many', ar: 'حذف عدة سجلات' },
    findVersions: { en: 'List versions', ar: 'عرض الإصدارات' },
    findVersionByID: { en: 'View a version', ar: 'عرض إصدار' },
    restoreVersion: { en: 'Restore a version', ar: 'استعادة إصدار' },
  },
  locale: {
    ar: { en: 'Arabic', ar: 'العربية' },
    en: { en: 'English', ar: 'الإنجليزية' },
  },
  screens: {
    dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
    portal: { en: 'Portal', ar: 'البوابة' },
    backoffice: { en: 'Backoffice', ar: 'لوحة الإدارة الخلفية' },
  },
  backoffice: {
    title: { en: 'Backoffice', ar: 'لوحة الإدارة الخلفية' },
    brand: { en: 'Asas backoffice', ar: 'لوحة الإدارة الخلفية لأساس' },
    about: { en: 'Every organization and every person, for the backoffice staff.', ar: 'كل مؤسسة وكل شخص، لفريق لوحة الإدارة الخلفية.' },
    role: { en: 'Backoffice role', ar: 'دور في لوحة الإدارة الخلفية' },
    noRole: { en: 'No backoffice role', ar: 'بلا دور في لوحة الإدارة الخلفية' },
    setRole: { en: 'Set role', ar: 'تعيين الدور' },
    ban: { en: 'Ban', ar: 'حظر' },
    unban: { en: 'Unban', ar: 'رفع الحظر' },
    impersonate: { en: 'Impersonate', ar: 'انتحال الصفة' },
    confirmRole: { en: 'Give {name} the backoffice role "{role}"?', ar: 'منح {name} الدور "{role}" في لوحة الإدارة الخلفية؟' },
    pickRole: { en: 'Pick another backoffice role for {name}.', ar: 'اختر دورًا آخر في لوحة الإدارة الخلفية لـ {name}.' },
    confirmBan: {
      en: 'Ban {name}? They are signed out of both apps and cannot sign in until the ban ends.',
      ar: 'حظر {name}؟ سيُسجَّل خروجه من التطبيقين ولن يتمكن من تسجيل الدخول حتى ينتهي الحظر.',
    },
    confirmUnban: { en: 'Lift the ban on {name}? They can sign in again.', ar: 'رفع الحظر عن {name}؟ سيتمكن من تسجيل الدخول مجددا.' },
    confirmImpersonate: {
      en: 'Impersonate {name}? You act as them in the tenant app until you stop.',
      ar: 'انتحال صفة {name}؟ ستتصرف باسمه في تطبيق المؤسسة حتى تتوقف.',
    },
    roleSet: { en: '{name} now holds the backoffice role "{role}".', ar: 'أصبح دور {name} في لوحة الإدارة الخلفية "{role}".' },
    banned: { en: '{name} is banned.', ar: 'تم حظر {name}.' },
    unbanned: { en: 'The ban on {name} is lifted.', ar: 'تم رفع الحظر عن {name}.' },
    renamed: { en: 'The organization is now named {name}.', ar: 'أصبح اسم المؤسسة {name}.' },
    refusedBanned: { en: 'This person is banned, so they cannot be impersonated.', ar: 'هذا الشخص محظور، فلا يمكن انتحال صفته.' },
    banReason: { en: 'Reason', ar: 'السبب' },
    banReasonNeeded: { en: 'A ban needs a reason.', ar: 'يحتاج الحظر إلى سبب.' },
    banEnds: { en: 'Ban lasts', ar: 'مدة الحظر' },
    banUntilLifted: { en: 'Until it is lifted', ar: 'حتى يُرفع' },
    banDay: { en: 'One day', ar: 'يوم واحد' },
    banWeek: { en: 'Seven days', ar: 'سبعة أيام' },
    banMonth: { en: 'Thirty days', ar: 'ثلاثون يومًا' },
    rename: { en: 'Rename', ar: 'إعادة التسمية' },
    nameIn: { en: 'Name in {language}, if it has one', ar: 'الاسم بـ{language}، إن كان لها اسم بها' },
    slugPattern: {
      en: 'A slug is lowercase letters and digits joined by single dashes, such as admin-org.',
      ar: 'المعرف النصي أحرف إنجليزية صغيرة وأرقام تفصل بينها شرطات مفردة، مثل admin-org.',
    },
    renameAbout: {
      en: 'The new name and slug take the place of the old ones for everyone in this organization.',
      ar: 'يحل الاسم والمعرّف الجديدان محل القديمين لكل من في هذه المؤسسة.',
    },
    members: { en: 'Members', ar: 'الأعضاء' },
    refused: { en: 'The backoffice refused that action.', ar: 'رفضت لوحة الإدارة الخلفية هذا الإجراء.' },
    'membership.owner': { en: 'Owner', ar: 'المالك' },
    'membership.admin': { en: 'Admin', ar: 'مشرف' },
    'membership.member': { en: 'Member', ar: 'عضو' },
  },
  user: {
    singular: { en: 'Person', ar: 'شخص' },
    plural: { en: 'People', ar: 'الأشخاص' },
    none: { en: 'No people yet.', ar: 'لا يوجد أشخاص بعد.' },
    id: { en: 'ID', ar: 'المعرّف' },
    name: { en: 'Name', ar: 'الاسم' },
    email: { en: 'Email', ar: 'البريد الإلكتروني' },
    emailVerified: { en: 'Email verified', ar: 'البريد موثق' },
    image: { en: 'Image', ar: 'الصورة' },
    role: { en: 'Backoffice role', ar: 'دور في لوحة الإدارة الخلفية' },
    banned: { en: 'Banned', ar: 'محظور' },
    banReason: { en: 'Ban reason', ar: 'سبب الحظر' },
    banExpires: { en: 'Ban ends', ar: 'ينتهي الحظر' },
    createdAt: { en: 'Created at', ar: 'تاريخ الإنشاء' },
    updatedAt: { en: 'Updated at', ar: 'تاريخ التعديل' },
  },
  organization: {
    ...copyFile(organization),
    singular: { en: 'Organization', ar: 'مؤسسة' },
    plural: { en: 'Organizations', ar: 'المؤسسات' },
    none: { en: 'No organizations yet.', ar: 'لا توجد مؤسسات بعد.' },
    id: { en: 'ID', ar: 'المعرّف' },
    name: { en: 'Name', ar: 'الاسم' },
    slug: { en: 'Slug', ar: 'المعرّف النصي' },
    logo: { en: 'Logo', ar: 'الشعار' },
    metadata: { en: 'Metadata', ar: 'البيانات الوصفية' },
    createdAt: { en: 'Created at', ar: 'تاريخ الإنشاء' },
    updatedAt: { en: 'Updated at', ar: 'تاريخ التعديل' },
  },
  member: {
    singular: { en: 'Member', ar: 'عضو' },
    plural: { en: 'Members', ar: 'الأعضاء' },
    none: { en: 'No members yet.', ar: 'لا يوجد أعضاء بعد.' },
    id: { en: 'ID', ar: 'المعرّف' },
    userId: { en: 'Person', ar: 'الشخص' },
    organizationId: { en: 'Organization', ar: 'المؤسسة' },
    role: { en: 'Membership role', ar: 'دور العضوية' },
    createdAt: { en: 'Created at', ar: 'تاريخ الإنشاء' },
    updatedAt: { en: 'Updated at', ar: 'تاريخ التعديل' },
    lastSeenAt: { en: 'Last seen', ar: 'آخر ظهور' },
  },
  // add-on: settings
  settings: {
    ...copyFile(settings),
    singular: { en: 'Settings', ar: 'الإعدادات' },
    plural: { en: 'Settings', ar: 'الإعدادات' },
  },
  // end add-on: settings
  // add-on: roles
  roles: {
    ...copyFile(roles),
    singular: { en: 'Role', ar: 'دور' },
    plural: { en: 'Roles', ar: 'الأدوار' },
    'delete.confirm': { en: 'Delete this role', ar: 'احذف هذا الدور' },
    new: { en: 'New role', ar: 'دور جديد' },
    none: { en: 'No roles yet.', ar: 'لا توجد أدوار بعد.' },
    dangerZoneWarning: {
      en: 'Deleting this role takes it away for everyone. A role a member holds is not deleted: take it from each of them on the Members page first.',
      ar: 'حذف هذا الدور يزيله للجميع. لا يُحذف دور يشغله عضو: اسحبه من كل منهم في صفحة الأعضاء أولا.',
    },
    'name.description': {
      en: 'The role\'s slug, which every assignment of it names, such as course-editor. People read the role by its label below.',
      ar: 'المعرف النصي للدور، الذي يسميه كل إسناد له، مثل course-editor. يقرأ الناس الدور بتسميته أدناه.',
    },
  },
  // end add-on: roles
  // add-on: courses
  sessions: {
    ...copyFile(sessions),
    singular: { en: 'Session', ar: 'جلسة' },
    plural: { en: 'Sessions', ar: 'الجلسات' },
    'operations.archiveMany': { en: 'Archive many', ar: 'أرشفة عدة جلسات' },
    'operations.archive': { en: 'Archive', ar: 'أرشفة' },
    'operations.archive.reason.required': { en: 'An archive reason is required.', ar: 'سبب الأرشفة مطلوب.' },
    'operations.archive.reason.maxLength': { en: 'An archive reason is at most 200 characters.', ar: 'سبب الأرشفة 200 حرف على الأكثر.' },
    'operations.unarchive': { en: 'Unarchive', ar: 'إلغاء الأرشفة' },
    'operations.unarchive.reason.required': { en: 'A reason to bring it back is required.', ar: 'سبب إلغاء الأرشفة مطلوب.' },
    'operations.unarchive.reason.maxLength': { en: 'A reason to bring it back is at most 200 characters.', ar: 'سبب إلغاء الأرشفة 200 حرف على الأكثر.' },
    new: { en: 'New session', ar: 'جلسة جديدة' },
    none: { en: 'No sessions yet.', ar: 'لا توجد جلسات بعد.' },
    dangerZoneWarning: { en: 'These actions change this session for everyone.', ar: 'هذه الإجراءات تغير هذه الجلسة للجميع.' },
  },
  // end add-on: courses
  // add-on: courses
  enrollments: {
    ...copyFile(enrollments),
    singular: { en: 'Enrollment', ar: 'تسجيل' },
    plural: { en: 'Enrollments', ar: 'التسجيلات' },
    'operations.others': { en: 'Everyone\'s enrollments', ar: 'تسجيلات الجميع' },
    new: { en: 'New enrollment', ar: 'تسجيل جديد' },
    none: { en: 'No enrollments yet.', ar: 'لا توجد تسجيلات بعد.' },
    dangerZoneWarning: { en: 'These actions change this enrollment for everyone.', ar: 'هذه الإجراءات تغير هذا التسجيل للجميع.' },
  },
  // end add-on: courses
  tags: {
    ...copyFile(tags),
    new: { en: 'New tag', ar: 'وسم جديد' },
    none: { en: 'No tags yet.', ar: 'لا توجد وسوم بعد.' },
    dangerZoneWarning: { en: 'These actions change this tag for everyone.', ar: 'هذه الإجراءات تغير هذا الوسم للجميع.' },
  },
  // add-on: media
  media: {
    ...copyFile(media),
    new: { en: 'New image', ar: 'صورة جديدة' },
    none: { en: 'No images yet.', ar: 'لا توجد صور بعد.' },
    newAbout: { en: 'Choose an image and describe it. It is uploaded before it is saved.', ar: 'اختر صورة وصِفها. تُرفع قبل أن تُحفظ.' },
    download: { en: 'Download', ar: 'تنزيل' },
    replace: { en: 'Replace file', ar: 'استبدال الملف' },
    replaceAbout: { en: 'Replace file uploads a new image and opens it. This one stays until you delete it.', ar: 'يرفع استبدال الملف صورة جديدة ويفتحها. تبقى هذه الصورة حتى تحذفها.' },
    dangerZoneWarning: { en: 'These actions change this image for everyone.', ar: 'هذه الإجراءات تغير هذه الصورة للجميع.' },
  },
  // end add-on: media
  localUsers: { ...copyFile(localUsers), none: { en: 'No local accounts yet.', ar: 'لا توجد حسابات محلية بعد.' } },
  // add-on: audit-log
  auditLog: copyFile(auditLog),
  backofficeLog: { ...copyFile(backofficeLog), none: { en: 'No staff action yet.', ar: 'لا يوجد إجراء للطاقم بعد.' } },
  // end add-on: audit-log
  // add-on: roles
  memberRoles: {
    ...copyFile(memberRoles),
    singular: { en: 'Member role', ar: 'دور عضو' },
    plural: { en: 'Member roles', ar: 'أدوار الأعضاء' },
    none: { en: 'No member roles yet.', ar: 'لا توجد أدوار أعضاء بعد.' },
  },
  // end add-on: roles
  version: {
    saveDraft: { en: 'Save draft', ar: 'حفظ المسودة' },
    noReadableChange: { en: 'No field you may read changed.', ar: 'لم يتغير حقل يمكنك قراءته.' },
    publish: { en: 'Publish', ar: 'نشر' },
    publishChanges: { en: 'Publish changes', ar: 'نشر التغييرات' },
    status: { en: 'Status', ar: 'الحالة' },
    draft: { en: 'Draft', ar: 'مسودة' },
    published: { en: 'Published', ar: 'منشور' },
    changed: { en: 'Changed', ar: 'تغييرات غير منشورة' },
    archived: { en: 'Archived', ar: 'مؤرشف' },
    saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
    saved: { en: 'Saved', ar: 'تم الحفظ' },
    updatedAgo: { en: 'Updated {time}', ar: 'تم التحديث {time}' },
    loading: { en: 'Loading versions…', ar: 'جارٍ تحميل الإصدارات…' },
    failed: { en: 'The versions could not be read.', ar: 'تعذرت قراءة الإصدارات.' },
    none: { en: 'No versions yet.', ar: 'لا توجد إصدارات بعد.' },
    updatedAt: { en: 'Updated at', ar: 'تاريخ التحديث' },
    autosave: { en: 'Autosave', ar: 'حفظ تلقائي' },
    currentDraft: { en: 'Current draft', ar: 'المسودة الحالية' },
    currentlyPublished: { en: 'Currently published', ar: 'نشر حاليا' },
    previouslyPublished: { en: 'Previously published', ar: 'نشر سابقا' },
    compareVersions: { en: 'Compare versions', ar: 'قارن الإصدارات' },
    comparingAgainst: { en: 'Comparing against', ar: 'مقارنة مع' },
    currentlyViewing: { en: 'Currently viewing', ar: 'الإصدار المعروض' },
    previousVersion: { en: 'Previous version', ar: 'النسخة السابقة' },
    modifiedOnly: { en: 'Modified only', ar: 'تم التعديل فقط' },
    fieldChanged: { en: 'Changed', ar: 'تغيّر' },
    restoreAsDraft: { en: 'Restore as draft', ar: 'استعادة كمسودة' },
    restoreThisVersion: { en: 'Restore this version', ar: 'استعادة هذا الإصدار' },
    confirmVersionRestoration: { en: 'Confirm version restoration', ar: 'تأكيد استعادة الإصدار' },
    aboutToRestore: {
      en: 'You are about to restore this {label} to the state it was in on {versionDate}.',
      ar: 'أنت على وشك استعادة هذا السجل ({label}) كما كان في {versionDate}.',
    },
    restore: { en: 'Restore', ar: 'استعادة' },
    problemRestoringVersion: { en: 'There was a problem restoring this version', ar: 'حدث خطأ في استعادة هذه النّسخة' },
    more: { en: 'Show older', ar: 'عرض الأقدم' },
    shownCopy: { en: 'Version shown', ar: 'النسخة المعروضة' },
    editingDraft: { en: 'You are editing a draft. The published version is different.', ar: 'أنت تحرر مسودة. النسخة المنشورة مختلفة.' },
    viewPublished: { en: 'View published', ar: 'عرض النسخة المنشورة' },
    readOnlyPublished: { en: 'Read only. This is the published version.', ar: 'للقراءة فقط. هذه هي النسخة المنشورة.' },
    confirmRevertToSaved: { en: 'Confirm revert to saved', ar: 'تأكيد الرّجوع للنسخة المنشورة' },
    aboutToRevertToPublished: {
      en: 'You are about to revert this document\'s changes to its published state. Are you sure?',
      ar: 'أنت على وشك إعادة هذا المستند إلى حالته المنشورة. هل أنت متأكّد؟',
    },
  },
  columns: {
    title: { en: 'Columns', ar: 'الأعمدة' },
    customize: { en: 'Customize Columns', ar: 'تخصيص الأعمدة' },
    shown: { en: 'Shown', ar: 'معروضة' },
    hidden: { en: 'Not shown', ar: 'غير معروضة' },
    up: { en: 'Move up', ar: 'نقل لأعلى' },
    down: { en: 'Move down', ar: 'نقل لأسفل' },
  },
  filter: {
    where: { en: 'Where', ar: 'حيث' },
    join: { en: 'Join', ar: 'الرابط' },
    and: { en: 'and', ar: 'و' },
    or: { en: 'or', ar: 'أو' },
    field: { en: 'Field', ar: 'الحقل' },
    operator: { en: 'Operator', ar: 'العامل' },
    remove: { en: 'Remove', ar: 'إزالة' },
    add: { en: 'Add filter', ar: 'إضافة مرشح' },
  },
  /**
   * One entry per operator the panel offers. `contains` and `like` must read differently
   * in every locale: the store splits `like` on whitespace and runs one `ilike` per word.
   */
  operator: {
    contains: { en: 'contains', ar: 'يحتوي' },
    equals: { en: 'is', ar: 'يساوي' },
    exists: { en: 'exists', ar: 'موجود' },
    greater_than: { en: 'is after', ar: 'بعد' },
    greater_than_equal: { en: 'is at least', ar: 'على الأقل' },
    in: { en: 'is one of', ar: 'واحد من' },
    less_than: { en: 'is before', ar: 'قبل' },
    less_than_equal: { en: 'is at most', ar: 'على الأكثر' },
    like: { en: 'matches every word', ar: 'يطابق كل كلمة' },
    not_equals: { en: 'is not', ar: 'لا يساوي' },
    not_in: { en: 'is none of', ar: 'ليس واحدا من' },
  },
  error: {
    'invalid.value': { en: 'That value will not do.', ar: 'هذه القيمة غير صالحة.' },
    'invalid.fields_one': { en: 'The following field is invalid: {fields}', ar: 'الحقل التالي غير صالح: {fields}' },
    'invalid.fields_two': { en: 'The following fields are invalid: {fields}', ar: 'الحقلان التاليان غير صالحين: {fields}' },
    'invalid.fields_other': { en: 'The following fields are invalid: {fields}', ar: 'الحقول التالية غير صالحة: {fields}' },
    'forbidden.create': { en: 'You may not write this.', ar: 'لا يمكنك كتابة هذا.' },
    'forbidden.update': { en: 'You may not change this.', ar: 'لا يمكنك تغيير هذا.' },
    'forbidden.delete': { en: 'You may not delete this.', ar: 'لا يمكنك حذف هذا.' },
    'forbidden.read': { en: 'You may not read this.', ar: 'لا يمكنك قراءة هذا.' },
    'forbidden.permission': { en: 'You do not hold the permission this needs.', ar: 'لا تملك الصلاحية التي يتطلبها هذا.' },
    'forbidden.local_auth_off': {
      en: 'Local sign-in is off on this server: LOCAL_AUTH_SECRET is not set. Set it to a secret of 32 characters at least and restart the server.',
      ar: 'تسجيل الدخول المحلي متوقف على هذا الخادم: لم يُضبط LOCAL_AUTH_SECRET. اضبطه بسر من 32 حرفا على الأقل وأعد تشغيل الخادم.',
    },
    'not_found.row': { en: 'That row is no longer there.', ar: 'لم يعد هذا السجل موجودا.' },
    'conflict.retry': { en: 'Another write interrupted this transaction. Try again.', ar: 'تعارضت هذه المعاملة مع عملية أخرى. حاول مرة أخرى.' },
    'conflict.target': { en: 'The authorized record cannot change.', ar: 'لا يمكن تغيير السجل المصرح به.' },
    'conflict.unique': { en: 'Another row already holds that value.', ar: 'يحمل سجل آخر هذه القيمة بالفعل.' },
    'conflict.stale': { en: 'This was changed by someone else since you opened it. Reload it and make your change again.', ar: 'غيّر شخص آخر هذا منذ فتحته. أعد تحميله ثم أعد إجراء تغييرك.' },
    'invalid.reference': { en: 'That record is not one you may choose.', ar: 'هذا السجل ليس مما يمكنك اختياره.' },
    'invalid.tenant_reference': { en: 'That record is not one of this organization\'s.', ar: 'هذا السجل ليس من سجلات هذه المؤسسة.' },
    'forbidden.assign': { en: 'You may not hand over a role that holds a permission you do not hold.', ar: 'لا يمكنك منح دور يحمل صلاحية لا تملكها.' },
    'invalid.role': { en: 'That role is not one of this organization\'s.', ar: 'هذا الدور ليس من أدوار هذه المؤسسة.' },
    'forbidden.system_role': { en: 'This role ships with the project and cannot be changed.', ar: 'هذا الدور يأتي مع المشروع ولا يمكن تغييره.' },
    'invalid.permission_fields': { en: 'A role that holds an operation of a collection must also hold at least one of its fields, or every read of it is refused.', ar: 'الدور الذي يملك عملية على مجموعة يجب أن يملك حقلا واحدا منها على الأقل، وإلا رُفضت كل قراءة لها.' },
    'conflict.role_held': { en: 'Members hold this role, so it is not deleted or renamed until none does.', ar: 'يشغل أعضاء هذا الدور، لذا لا يُحذف ولا يُعاد تسميته حتى لا يشغله أحد.' },
    'conflict.role_assigned': { en: 'An assignment of this organization still names that role, so no role takes the name until it is removed.', ar: 'ما زال إسناد في هذه المؤسسة يسمي هذا الدور، لذا لا يأخذ أي دور هذا الاسم حتى يُزال.' },
    'forbidden.own_role': { en: 'You may not take from yourself the role that lets you manage roles.', ar: 'لا يمكنك سحب الدور الذي يتيح لك إدارة الأدوار من نفسك.' },
    'forbidden.owner_role': { en: 'The owner of the organization always holds the administrator role, so it is not taken from them.', ar: 'مالك المؤسسة يشغل دور المدير دائما، لذا لا يُسحب منه.' },
    'invalid.member_role': { en: 'A role is named exactly, with no spaces around it.', ar: 'يُسمّى الدور بدقة، دون مسافات حوله.' },
    'conflict.last_manager': { en: 'This would leave the organization with nobody who may manage roles. Give another member such a role first.', ar: 'سيترك هذا المؤسسة دون أي عضو يملك إدارة الأدوار. امنح عضوا آخر دورا كهذا أولا.' },
    'invalid.archived_session': { en: 'This session is archived, or its course is, so it takes no new seat. Pick an open session.', ar: 'هذه الحصة مؤرشفة، أو دورتها مؤرشفة، فلا تقبل مقعدا جديدا. اختر حصة مفتوحة.' },
    // add-on: courses
    'invalid.enrollment_closed': { en: 'Students of this course do not enroll themselves. Ask your school to enroll you.', ar: 'لا يسجّل طلاب هذه الدورة أنفسهم. اطلب من مدرستك تسجيلك.' },
    'invalid.session_started': { en: 'This session has started, so its seats no longer change.', ar: 'بدأت هذه الجلسة، فلم تعد مقاعدها تتغير.' },
    'conflict.session_full': { en: 'Every seat of this session is taken. Pick another session.', ar: 'كل مقاعد هذه الجلسة محجوزة. اختر جلسة أخرى.' },
    // end add-on: courses
    // add-on: courses, settings
    'invalid.portal_closed': { en: 'The portal is closed for maintenance, so no enrollment changes from it just now.', ar: 'البوابة مغلقة للصيانة، فلا يتغير منها أي تسجيل الآن.' },
    // end add-on: courses, settings
    'invalid.draft_sessions': { en: 'A course saved as a draft makes no sessions. Publish the course, then add its sessions.', ar: 'الدورة المحفوظة كمسودة لا تُنشئ جلسات. انشر الدورة أولًا، ثم أضف جلساتها.' },
    'invalid.upload_request': { en: 'The file has no name, or no size, that can be uploaded.', ar: 'ليس للملف اسم أو حجم يمكن رفعه.' },
    'invalid.upload_type': { en: 'Files of this type are not taken here.', ar: 'لا تُقبل هنا ملفات من هذا النوع.' },
    'invalid.upload_size': { en: 'The file is larger than this place takes.', ar: 'الملف أكبر مما يُقبل هنا.' },
    'invalid.upload_reference': { en: 'The upload has expired or is not this one. Upload the file again.', ar: 'انتهت صلاحية الرفع أو أنه ليس لهذا الملف. ارفع الملف مرة أخرى.' },
    'invalid.upload_verify': { en: 'The file is not what it said it was, so it was not kept. Upload another.', ar: 'الملف ليس كما ادّعى، لذا لم يُحفظ. ارفع ملفا آخر.' },
    'not_found.file': { en: 'That file is not here.', ar: 'هذا الملف غير موجود.' },
    'conflict.referenced': { en: 'Something still uses this, so it is not deleted.', ar: 'ما زال شيء يستخدم هذا، لذا لا يُحذف.' },
    'conflict.member_holds_roles': {
      en: 'This member still holds a role in this organization. Take each role from them first, then remove them.',
      ar: 'ما زال هذا العضو يشغل دورا في هذه المؤسسة. اسحب منه كل دور أولا، ثم أزله.',
    },
    'conflict.referencedBy': { en: '{kind} still use this, so it is not deleted.', ar: 'ما زالت {kind} تستخدم هذا، لذا لا يُحذف.' },
    'conflict.usedBy': { en: 'Used by {count} {kind}: {titles}.', ar: 'تستخدمه {kind} ({count}): {titles}.' },
    'conflict.usedByUnnamed': { en: 'Used by {count} {kind}.', ar: 'تستخدمه {kind} ({count}).' },
    'conflict.usedMore': { en: '{count} more', ar: '{count} أخرى' },
    'conflict.usedHint': { en: 'Take it out of them first.', ar: 'أزله منها أولا.' },
    'conflict.sole_owner': {
      en: 'This person is the only owner of an organization, so they are not deleted. Make another member its owner first.',
      ar: 'هذا الشخص هو المالك الوحيد لمؤسسة، لذا لا يُحذف. اجعل عضوا آخر مالكا لها أولا.',
    },
  },
}

type Wording = Record<string, Record<string, { en: string; ar: string }>>

/** With one organization, nobody founds one on signing up: an owner sets the app up once. */
const one: Wording = {
  auth: {
    noOrganization: { en: '{email} has no access here yet.', ar: 'لا يملك {email} وصولا هنا بعد.' },
  },
  marketing: {
    howStep1Title: { en: 'Set it up once', ar: 'أعدّه مرة واحدة' },
    howStep1Description: { en: 'Its owner sets the app up, then invites the people who use it.', ar: 'يُعدّ مالكه التطبيق، ثم يدعو من يستعملونه.' },
    ctaSubtitle: { en: 'Sign in and add your first record in minutes.', ar: 'سجل الدخول وأضف أول سجل لك خلال دقائق.' },
  },
}

/** With the one organization never shown, it is the app itself, so no page names an organization. */
const unnamed: Wording = {
  auth: {
    invitationJoin: { en: 'You are invited to join this app.', ar: 'أنت مدعو للانضمام إلى هذا التطبيق.' },
    invitationInviterGone: {
      en: 'Whoever sent this invitation no longer uses this app, so it cannot be accepted. Ask someone else to invite you.',
      ar: 'من أرسل هذه الدعوة لم يعد يستعمل هذا التطبيق، لذا لا يمكن قبولها. اطلب من شخص آخر أن يدعوك.',
    },
    noAccessDescription: { en: '{email} holds no role that opens a screen here. Ask an administrator to give you one.', ar: '{email} لا يملك دورا يفتح أي شاشة هنا. اطلب من أحد المسؤولين أن يمنحك دورا.' },
  },
  admin: {
    noColumns: { en: 'Your role can\'t see any column of this list. Ask an administrator for access.', ar: 'لا يستطيع دورك رؤية أي عمود في هذه القائمة. اطلب الوصول من أحد المسؤولين.' },
  },
  marketing: {
    heroTitle: { en: 'Run your work without the busywork', ar: 'أدر عملك دون العمل الروتيني' },
    heroSubtitle: {
      en: 'Asas is a dashboard and a portal: keep your records in one place, and keep every role to what it should see.',
      ar: 'أساس لوحة تحكم وبوابة: احفظ سجلاتك في مكان واحد، واحصر كل دور بما ينبغي أن يراه.',
    },
    featuresTitle: { en: 'Everything you need', ar: 'كل ما تحتاجه' },
    featureRolesDescription: {
      en: 'Every screen, field and action follows what a role may read or write.',
      ar: 'تتبع كل شاشة وحقل وإجراء ما يحق للدور قراءته أو تعديله.',
    },
    howStep2Description: { en: 'List what you keep and decide what each role may do.', ar: 'أدرج ما تحفظه وحدد ما يحق لكل دور القيام به.' },
    ctaTitle: { en: 'Start on Asas', ar: 'ابدأ على أساس' },
    footer: { en: 'Asas — one place for your records.', ar: 'أساس — مكان واحد لسجلاتك.' },
  },
  dashboard: {
    members: { en: 'Users', ar: 'المستخدمون' },
    membersAbout: { en: 'Who uses this app, and the role each holds.', ar: 'من يستعمل هذا التطبيق، والدور الذي يشغله كل منهم.' },
    membersNone: { en: 'No one uses this app yet.', ar: 'لا يستعمل أحد هذا التطبيق بعد.' },
    inviteAbout: { en: 'They join as a user once they accept. Give them roles here after that.', ar: 'ينضم مستخدمًا بعد أن يقبل الدعوة. امنحه الأدوار هنا بعد ذلك.' },
    inviteAlreadyMember: { en: 'This person already uses this app.', ar: 'هذا الشخص يستعمل هذا التطبيق بالفعل.' },
    inviteNotAllowed: { en: 'You may not invite people.', ar: 'لا يحق لك دعوة أشخاص.' },
    removeMember: { en: 'Remove from the app', ar: 'إزالة من التطبيق' },
    removeAbout: {
      en: 'They lose access to this app and every role they hold in it. Inviting them again does not give the roles back.',
      ar: 'يفقد الوصول إلى هذا التطبيق وكل الأدوار التي يشغلها فيه. دعوته مرة أخرى لا تعيد إليه أدواره.',
    },
    removeLastOwner: { en: 'The app\'s only owner cannot be removed.', ar: 'لا يمكن إزالة المالك الوحيد للتطبيق.' },
    removeNotAllowed: { en: 'You may not remove users.', ar: 'لا يحق لك إزالة مستخدمين.' },
    rolesAbout: { en: 'Fixed roles ship with the project and cannot be changed here. Custom roles are this app\'s own.', ar: 'الأدوار الثابتة تأتي مع المشروع ولا يمكن تغييرها هنا. الأدوار المخصصة خاصة بهذا التطبيق.' },
    membersOwnerRole: { en: 'The owner of the app always holds this role.', ar: 'مالك التطبيق يشغل هذا الدور دائما.' },
    dashboardAbout: { en: 'What this app holds, and how many have enrolled lately.', ar: 'ما يضمه هذا التطبيق، وعدد من سجلوا مؤخرا.' },
    dashboardAboutCatalogue: { en: 'What this app holds.', ar: 'ما يضمه هذا التطبيق.' },
  },
  error: {
    'invalid.tenant_reference': { en: 'That record is not one of this app\'s.', ar: 'هذا السجل ليس من سجلات هذا التطبيق.' },
    'conflict.last_manager': { en: 'This would leave nobody who may manage roles. Give another user such a role first.', ar: 'سيترك هذا التطبيق دون أي مستخدم يملك إدارة الأدوار. امنح مستخدما آخر دورا كهذا أولا.' },
    'forbidden.owner_role': { en: 'The owner of the app always holds the administrator role, so it is not taken from them.', ar: 'مالك التطبيق يشغل دور المدير دائما، لذا لا يُسحب منه.' },
    'invalid.role': { en: 'That role is not one of this app\'s.', ar: 'هذا الدور ليس من أدوار هذا التطبيق.' },
    'conflict.role_assigned': { en: 'An assignment still names that role, so no role takes the name until it is removed.', ar: 'ما زال إسناد يسمي هذا الدور، لذا لا يأخذ أي دور هذا الاسم حتى يُزال.' },
    'conflict.member_holds_roles': { en: 'This user still holds a role. Take each role from them first, then remove them.', ar: 'ما زال هذا المستخدم يشغل دورا. اسحب منه كل دور أولا، ثم أزله.' },
    'conflict.sole_owner': { en: 'This person is the app\'s only owner, so they are not deleted. Make another user an owner first.', ar: 'هذا الشخص هو المالك الوحيد للتطبيق، لذا لا يُحذف. اجعل مستخدما آخر مالكا أولا.' },
  },
}

/** The words the organization mode changes, laid over the base copy key by key. */
export const wordingFor = (mode: { organizations: 'one' | 'many'; showOrganization: boolean }): Wording =>
  mode.organizations === 'many' ? {} : mode.showOrganization ? one : Object.fromEntries([...new Set([...Object.keys(one), ...Object.keys(unnamed)])].map((scope) => [scope, { ...one[scope], ...unnamed[scope] }]))

/** The base copy with `wording` laid over it, so a key the mode changes reads the mode's words. */
export const withWording = (base: typeof ownScopes, wording: Wording) =>
  Object.fromEntries(Object.entries(base).map(([scope, keys]) => [scope, { ...keys, ...wording[scope] }])) as typeof ownScopes

/**
 * Every scope this app's `t` can answer from, in this project's organization mode. Each entry
 * carries a string per declared locale: a key left unanswered here shows an Arabic viewer the
 * English fallback.
 */
export const scopes = withWording(ownScopes, wordingFor({ organizations, showOrganization }))

// A `Map`, so a code named for a key of `Object.prototype` answers nothing. A taken organization
// name has no entry: names may repeat, and sign-up makes the slug unique itself.
const refusalKeys = new Map([
  ['INVALID_EMAIL_OR_PASSWORD', 'auth.invalidCredentials'],
  ['EMAIL_NOT_VERIFIED', 'auth.emailNotVerified'],
  ['BANNED_USER', 'auth.banned'],
  ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'auth.userExists'],
  ['INVALID_EMAIL', 'auth.invalidEmail'],
  ['INVITATION_NOT_FOUND', 'auth.invitationGone'],
  ['YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', 'auth.invitationNotYours'],
  ['INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION', 'auth.invitationInviterGone'],
  ['USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', 'dashboard.inviteAlreadyMember'],
  ['USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION', 'dashboard.inviteAlreadyInvited'],
  ['YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION', 'dashboard.inviteNotAllowed'],
  ['YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION', 'dashboard.inviteCancelNotAllowed'],
  ['YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER', 'dashboard.removeLastOwner'],
  ['YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER', 'dashboard.removeNotAllowed'],
  ['RESET_PASSWORD_DISABLED', 'auth.resetDisabled'],
  ['INVALID_TOKEN', 'auth.tokenInvalid'],
  ['SETUP_CODE_WRONG', 'auth.setupCodeWrong'],
  ['SETUP_CODE_UNSET', 'auth.setupCodeUnset'],
  ['FIRST_REGISTER_CLOSED', 'auth.firstRegisterClosed'],
  ['FIRST_RUN_CLOSED', 'auth.firstRunClosed'],
  ['FIRST_RUN_PENDING', 'auth.setupPending'],
  ['SIGN_UP_INVITE_ONLY', 'auth.inviteOnly'],
  ['SIGN_UP_DOMAIN', 'auth.outsideDomains'],
])
/** The key of this app's own sentence for a provider refusal, or nothing. The provider's `message` is English on every page and is never shown. */
export const refusalKey = (status: number, code: unknown): string | undefined =>
  status === 429 ? 'auth.tooManyRequests' : typeof code === 'string' ? refusalKeys.get(code) : undefined

/** The `t` a screen is handed, for one locale. A key splits at its first dot into scope and key; an unanswered key returns the caller's fallback. */
const generatedCopy = copyFile(mithaq)

export const translator =
  (which: string): Translate =>
  (key, fallback) => {
    const dot = key.indexOf('.')
    if (dot < 0) return fallback
    return scopes[key.slice(0, dot)]?.[key.slice(dot + 1)]?.[which] ?? generatedCopy[key]?.[which] ?? fallback
  }

/**
 * A route's `head`: the tab names the page, then the app, or the app alone where the page
 * names nothing. `app` is a key the root route puts in its context beside the locale.
 */
export const documentHead = ({ locale, app }: { locale: Locale; app?: string }, page?: (t: Translate) => string | undefined) => {
  const t = translator(locale)
  const own = app ? t(app, app)! : ''
  const name = page?.(t)
  return { meta: [{ title: name && own ? `${name} · ${own}` : name || own }] }
}

/**
 * Sets the cookie the request middleware reads and redraws the page in `to` where it stands, as Payload's language
 * switch refreshes its router: nothing typed into a form is lost. The root route reads the locale off the document.
 */
export const showLocale = async ({ to, router }: { to: string; router: { invalidate(): Promise<unknown> } }) => {
  const locale = localeOf(to)
  document.cookie = localeCookieValue(locale)
  document.documentElement.lang = locale
  document.documentElement.dir = dirOf(locale)
  await router.invalidate()
}

/**
 * Sets the cookie the request middleware reads, then reloads so the server draws the document
 * in it: a screen's form is seeded again from whatever row the host hands, so the shell asks before it
 * drops a change nobody saved, and its own unsaved-changes guard is dropped because the shell already asked.
 */
export const switchLocale = ({ to }: { to: string }): void => {
  window.onbeforeunload = null
  document.cookie = localeCookieValue(localeOf(to))
  window.location.reload()
}
