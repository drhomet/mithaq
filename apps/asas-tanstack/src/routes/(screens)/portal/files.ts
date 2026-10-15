// Written by `mithaq generate screens`. Do not edit.
/// <reference types="vite/client" />
// Every file the `portal` screen's references name, each loaded when a page draws it, keyed as the reference prints it.
const named = (name: string, files: Record<string, () => Promise<unknown>>) => Object.fromEntries(Object.entries(files).map(([file, load]) => [`${name}:${file}`, load]))
export const files = {
  ...import.meta.glob(['./src/ui-portal/courses-home.tsx', './src/ui-portal/page.tsx'], { base: '../../../../../../templates/asas/', exhaustive: true }),
  ...named('@asas/courses', import.meta.glob(['./courses/ui/fee-cell.tsx', './enrollments/ui/session-cell.tsx', './enrollments/ui/session-labels.tsx', './portal/ui/catalogue.tsx', './portal/ui/course.tsx', './portal/ui/enrollments.tsx', './portal/ui/shell.tsx'], { base: '../../../../../../templates/features/courses/', exhaustive: true })),
  ...named('@asas/mithaq', import.meta.glob(['./src/ui/rich-text-nodes.tsx'], { base: '../../../../../../templates/mithaq/', exhaustive: true })),
}
