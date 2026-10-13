import type { ComponentProps, ReactElement } from 'react'
import type { Translate } from './copy.ts'
import { DraftBanner } from './draft-banner.tsx'
import { ViewSwitch, type Views } from './form-actions.tsx'

/**
 * What a form draws above its fields: its title and sentence, a refusal naming no field where no controls node
 * draws one, the draft or published switch below xl, and what a changed row says.
 */
export function FormChrome({ about, banner, draft, headed, t, title, views }: {
  /** Whether the form draws a header at all: on a screen's page a kayan with no sentence draws none, and no rule under it. */
  headed: boolean
  /** The heading, which a screen's page leaves to its own `title` node. */
  title?: string
  about?: string
  banner?: string
  /** The draft or published switch, where a controls node draws the actions and so leaves the switch to the top of the form. */
  views?: Views
  /** What a changed row says, on a changed row only. */
  draft?: Omit<ComponentProps<typeof DraftBanner>, 't'>
  t: Translate
}): ReactElement {
  return (
    <>
      {headed ? (
        <header className="max-w-3xl">
          {title === undefined ? null : <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
          {about ? <p className="text-muted-foreground mt-1 text-sm">{about}</p> : null}
        </header>
      ) : null}
      {banner === undefined ? null : (
        <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
          {banner}
        </p>
      )}
      {views ? <ViewSwitch className="xl:hidden" phone {...views} t={t} /> : null}
      {draft ? <DraftBanner {...draft} t={t} /> : null}
    </>
  )
}
