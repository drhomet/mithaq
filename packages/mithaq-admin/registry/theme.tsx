import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { Translate } from 'mithaq/admin'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** The values the theme toggle offers. */
export type Theme = 'dark' | 'light' | 'system'

/** The themes the user menu offers unless the project passes its own to `NavUserMenu`. */
export const defaultThemes: readonly Theme[] = ['light', 'dark', 'system']

type ThemeProviderProps = {
  children: ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
}

/** `null` outside a provider, so a menu that offers the choice draws nothing where nothing would keep it. */
const ThemeProviderContext = createContext<ThemeProviderState | null>(null)

/**
 * Keeps the theme in `localStorage` and puts `light` or `dark` on the document element. The stored
 * theme is read in the first browser render and not in an effect: a change after mount re-renders
 * consumers, and inside an unhydrated Suspense boundary that makes React drop the server's HTML.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme
    const stored = localStorage.getItem(storageKey)
    // A stray value under this key would hydrate mismatched against the server's default.
    return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : defaultTheme
  })

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme: (newTheme: Theme) => {
        localStorage.setItem(storageKey, newTheme)
        setTheme(newTheme)
      },
    }),
    [theme, storageKey],
  )

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
}

/** The theme and its setter, or `null` where no `ThemeProvider` is above. */
export const useTheme = () => useContext(ThemeProviderContext)

/** A theme toggle button whose menu offers light, dark and system. */
export function ModeToggle({ t }: { t: Translate }) {
  const { setTheme } = useTheme() ?? initialState

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: 'outline', size: 'icon' })}>
        <HugeiconsIcon
          icon={Sun03Icon}
          className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
        />
        <HugeiconsIcon
          icon={Moon02Icon}
          className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
        />
        <span className="sr-only">{t('admin.theme', 'Toggle theme')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>{t('admin.themeLight', 'Light')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>{t('admin.themeDark', 'Dark')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          {t('admin.themeSystem', 'System')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
