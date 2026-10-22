import { createState } from 'lexical'

// NodeState keeps choices in Lexical JSON's `$`, apart from the forbidden CSS string.
export const colorChoice = createState('color', { parse: (value) => typeof value === 'string' ? value : '' })
export const sizeChoice = createState('size', { parse: (value) => typeof value === 'string' ? value : '' })
export const fontChoice = createState('font', { parse: (value) => typeof value === 'string' ? value : '' })
export const directionChoice = createState('direction', { parse: (value) => value === 'rtl' || value === 'ltr' ? value : 'auto' })
