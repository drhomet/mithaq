import { Button } from '@/components/ui/button'
import { localeEntries } from 'mithaq-admin/locale-menu.ts'
import { locales, switchLocale, type Locale } from './copy.ts'

/** The language switch for pages without a form: `switchLocale` reloads without asking, so a page with a form must use the user menu, which asks first. */
export function LocaleSwitch({ locale }: { locale: Locale }) {
  return (
    <div className="flex items-center gap-1">
      {localeEntries(locales, locale).map((entry) => (
        <Button
          key={entry.locale}
          type="button"
          variant={entry.active ? 'secondary' : 'ghost'}
          size="xs"
          aria-current={entry.active}
          aria-label={entry.label}
          onClick={() => switchLocale({ to: entry.locale })}
        >
          <span className="hidden sm:inline">{entry.label}</span>
          <span className="sm:hidden">{entry.locale.toUpperCase()}</span>
        </Button>
      ))}
    </div>
  )
}
// mithaq-admin 2d3ab739c92c6c2b397041b76bf4b23b2902b7a2 f368446b658a96c18880d9553abb0c09b71aa52808b542dfb023a3788bb99a87
