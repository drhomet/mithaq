export const snapshot = (row: unknown) =>
  row && typeof row === 'object' && !Array.isArray(row)
    ? Object.freeze({ ...(row as Record<string, unknown>) })
    : undefined
