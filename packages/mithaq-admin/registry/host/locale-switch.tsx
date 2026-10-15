import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { localeEntries } from 'mithaq-admin/locale-menu.ts'
import { locales, showLocale, type Locale } from './copy.ts'

/** The language switch of the auth and landing pages, which redraws the page in place, so a form keeps what was typed. */
export function LocaleSwitch({ locale }: { locale: Locale }) {
  const router = useRouter()
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
          onClick={() => void showLocale({ to: entry.locale, router })}
        >
          <span className="hidden sm:inline">{entry.label}</span>
          <span className="sm:hidden">{entry.locale.toUpperCase()}</span>
        </Button>
      ))}
    </div>
  )
}
