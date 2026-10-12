// The dashboard screen's one provider, folded around its shell: it marks the
// subtree the screen draws, so a stylesheet can scope to it.
import type { ReactNode } from 'react'
import type { ProviderProps } from 'mithaq/admin'

export const ThemeProvider = ({ children }: ProviderProps<ReactNode>) => (
  <div data-provider="theme" className="contents">
    {children}
  </div>
)
