// A row with no currency, one the reader may not read, or one Intl does not know keeps the plain
// number. The amount is a left-to-right isolate so Arabic neither reads "US$" as "$US" nor strands
// the dot of "ر.س." on the wrong side.
import type { CellProps } from 'mithaq/admin'
import { useLocale } from 'mithaq/admin/react'
import { noValue } from '@/components/mithaq/controls.tsx'

const amount = (text: string) => <bdi dir="ltr">{text}</bdi>

export function FeeCell({ value, row }: CellProps) {
  const { locale } = useLocale()
  if (typeof value !== 'number') return noValue
  try {
    if (typeof row.currency === 'string' && row.currency) return amount(new Intl.NumberFormat(locale, { style: 'currency', currency: row.currency }).format(value))
  } catch {
    // A code Intl refuses throws a RangeError; the number alone is still true.
  }
  return amount(value.toLocaleString(locale))
}
