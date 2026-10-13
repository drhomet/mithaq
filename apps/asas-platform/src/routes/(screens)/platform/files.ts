// Written by `mithaq generate screens`. Do not edit.
/// <reference types="vite/client" />
// Every file the `platform` screen's references name, each loaded when a page draws it, keyed as the reference prints it.
const named = (name: string, files: Record<string, () => Promise<unknown>>) => Object.fromEntries(Object.entries(files).map(([file, load]) => [`${name}:${file}`, load]))
export const files = {
  ...import.meta.glob(['./src/ui-dashboard/theme-provider.tsx', './src/ui-platform/home.tsx', './src/ui-platform/organization-actions.tsx', './src/ui-platform/record-page.tsx', './src/ui-platform/role-cells.tsx', './src/ui-platform/user-actions.tsx'], { base: '../../../../../../templates/asas/', exhaustive: true }),
  ...named('@asas/courses', import.meta.glob(['./courses/ui/fee-cell.tsx', './enrollments/ui/session-cell.tsx', './enrollments/ui/session-labels.tsx'], { base: '../../../../../../templates/features/courses/', exhaustive: true })),
  ...named('@asas/mithaq', import.meta.glob(['./src/ui/app-shell.tsx', './src/ui/rich-text-nodes.tsx', './src/ui/table-page.tsx'], { base: '../../../../../../templates/mithaq/', exhaustive: true })),
  ...named('@asas/roles', import.meta.glob(['./roles/ui/roles.tsx'], { base: '../../../../../../templates/features/roles/', exhaustive: true })),
}
