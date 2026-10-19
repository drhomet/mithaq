// Written by `mithaq generate screens`. Do not edit.
/// <reference types="vite/client" />
// Every file the `dashboard` screen's references name, each loaded when a page draws it, keyed as the reference prints it.
const named = (name: string, files: Record<string, () => Promise<unknown>>) => Object.fromEntries(Object.entries(files).map(([file, load]) => [`${name}:${file}`, load]))
export const files = {
  ...import.meta.glob(['./src/ui-dashboard/dashboard.tsx', './src/ui-dashboard/members.tsx', './src/ui-dashboard/theme-provider.tsx', './src/ui-dashboard/versions.tsx'], { base: '../../../../../../templates/asas/', exhaustive: true }),
  ...named('@asas/courses', import.meta.glob(['./courses/ui/archived-badge.tsx', './courses/ui/fee-cell.tsx', './courses/ui/no-courses.tsx', './courses/ui/status-cell.tsx', './courses/ui/unpublish-button.tsx', './enrollments/ui/session-cell.tsx', './enrollments/ui/session-labels.tsx'], { base: '../../../../../../templates/features/courses/', exhaustive: true })),
  ...named('@asas/media', import.meta.glob(['./media/ui/preview.tsx'], { base: '../../../../../../templates/features/media/', exhaustive: true })),
  ...named('@asas/mithaq', import.meta.glob(['./src/ui/activity-page.tsx', './src/ui/activity.tsx', './src/ui/app-shell.tsx', './src/ui/page-actions.tsx', './src/ui/record-page.tsx', './src/ui/rich-text-nodes.tsx', './src/ui/table-page.tsx', './src/ui/top-shell.tsx'], { base: '../../../../../../templates/mithaq/', exhaustive: true })),
  ...named('@asas/roles', import.meta.glob(['./roles/ui/role-form.tsx', './roles/ui/roles.tsx'], { base: '../../../../../../templates/features/roles/', exhaustive: true })),
}
