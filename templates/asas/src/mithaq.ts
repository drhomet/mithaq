// The `mithaq` command runs from this package and reads the language from
// `src/mithaq.ts` beside `src/asas.ts`: the lock, the generators and `migrate`
// read these four, wherever the language's own package sits.
export { defineKayan, generate, locales, targets } from '@asas/mithaq'
