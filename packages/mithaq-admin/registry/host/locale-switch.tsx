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
