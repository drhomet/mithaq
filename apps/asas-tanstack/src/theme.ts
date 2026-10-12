/**
 * Where the chosen theme is remembered. The React provider and the blocking head script both
 * read it, and disagreeing would flash the wrong theme on first paint.
 */
export const themeStorageKey = 'vite-ui-theme'
