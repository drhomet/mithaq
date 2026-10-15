// Written by `mithaq generate screens`. Do not edit.
/// <reference types="vite/client" />
// Every file the `backoffice` screen's references name, each loaded when a page draws it, keyed as the reference prints it.
const named = (name: string, files: Record<string, () => Promise<unknown>>) => Object.fromEntries(Object.entries(files).map(([file, load]) => [`${name}:${file}`, load]))
export const files = {
  ...import.meta.glob(['./src/ui-backoffice/home.tsx', './src/ui-backoffice/organization-actions.tsx', './src/ui-backoffice/record-page.tsx', './src/ui-backoffice/role-cells.tsx', './src/ui-backoffice/user-actions.tsx', './src/ui-dashboard/theme-provider.tsx'], { base: '../../../../../../templates/asas/', exhaustive: true }),
  ...named('@asas/courses', import.meta.glob(['./courses/ui/fee-cell.tsx', './enrollments/ui/session-cell.tsx', './enrollments/ui/session-labels.tsx'], { base: '../../../../../../templates/features/courses/', exhaustive: true })),
  ...named('@asas/mithaq', import.meta.glob(['./src/ui/app-shell.tsx', './src/ui/rich-text-nodes.tsx', './src/ui/table-page.tsx'], { base: '../../../../../../templates/mithaq/', exhaustive: true })),
  ...named('@asas/roles', import.meta.glob(['./roles/ui/roles.tsx'], { base: '../../../../../../templates/features/roles/', exhaustive: true })),
}
