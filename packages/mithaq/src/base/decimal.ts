// Read without passing a digit through a JS number, which would round a money
// value past 15 significant digits. Imports nothing, so a browser can load it.

/** Fixed-point text, held to what a Postgres `numeric` holds: 131072 digits before the point and 16383 after. */
export const isDecimal = (value: unknown): value is string => typeof value === 'string' && /^[+-]?\d{1,131072}(?:\.\d{1,16383})?$/.test(value)

/** How many digits a decimal holds before and after its point, as `numeric(precision, scale)` counts them. */
export const decimalDigits = (value: string) => {
  const [whole = '', fraction = ''] = value.replace(/^[+-]/, '').split('.')
  return { whole: whole.replace(/^0+/, '').length, fraction: fraction.length }
}

/** -1, 0 or 1 as `left` is below, equal to or above `right`, on two values `isDecimal` accepts. */
export const compareDecimals = (left: string, right: string): number => {
  const [a, b] = [left, right].map((one) => /^([+-]?\d+)(?:\.(\d+))?$/.exec(one)!)
  const scale = Math.max(a![2]?.length ?? 0, b![2]?.length ?? 0)
  const [first, second] = [a!, b!].map((one) => BigInt(one[1]! + (one[2] ?? '').padEnd(scale, '0')))
  return first! < second! ? -1 : first! > second! ? 1 : 0
}
