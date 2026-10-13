// Written by `mithaq generate screens`. Do not edit.
/// <reference types="vite/client" />
// Every file the `portal` screen's references name, each loaded when a page draws it, keyed as the reference prints it.
const named = (name: string, files: Record<string, () => Promise<unknown>>) => Object.fromEntries(Object.entries(files).map(([file, load]) => [`${name}:${file}`, load]))
export const files = {
  ...import.meta.glob(['./src/ui-portal/home.tsx', './src/ui-portal/page.tsx'], { base: '../../../../../../templates/asas/', exhaustive: true }),
  ...named('@asas/courses', import.meta.glob(['./courses/ui/archive-button.tsx', './courses/ui/fee-cell.tsx', './courses/ui/no-courses-on-offer.tsx', './enrollments/ui/session-cell.tsx', './enrollments/ui/session-labels.tsx'], { base: '../../../../../../templates/features/courses/', exhaustive: true })),
  ...named('@asas/mithaq', import.meta.glob(['./src/ui/record-page.tsx', './src/ui/rich-text-nodes.tsx', './src/ui/top-shell.tsx'], { base: '../../../../../../templates/mithaq/', exhaustive: true })),
}
