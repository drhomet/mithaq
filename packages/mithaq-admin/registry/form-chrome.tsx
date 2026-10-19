import { useEffect, useRef, type ComponentProps, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from 'mithaq-admin/page-header.tsx'
import type { Translate } from 'mithaq-admin/copy.ts'
import { DraftBanner } from 'mithaq-admin/draft-banner.tsx'
import { ViewSwitch, type Views } from 'mithaq-admin/form-actions.tsx'

/**
 * Opens whatever hides an element, a tab nobody opened or a closed section, by pressing the control that names the
 * hidden panel, then focuses it once that panel is drawn.
 */
export const reveal = (target: HTMLElement | null) => {
  if (!target) return
  for (let hidden = target.closest<HTMLElement>('[hidden]'); hidden; hidden = hidden.parentElement?.closest<HTMLElement>('[hidden]') ?? null) {
    if (hidden.id) target.ownerDocument.querySelector<HTMLElement>(`[aria-controls~="${CSS.escape(hidden.id)}"]`)?.click()
  }
  setTimeout(() => target.focus())
}

/**
 * The box of this form a summary line names: inside its <form>, or naming it by the `form` attribute from another
 * region, and never a box of the same id in another form, such as the one a drawer over this form draws.
 */
const boxOf = (line: HTMLElement, id: string): HTMLElement | null => {
  const form = line.closest('form')
  const found = line.ownerDocument.getElementById(id)
  const own = form?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? (form?.id ? form.ownerDocument.querySelector<HTMLElement>(`#${CSS.escape(id)}[form="${CSS.escape(form.id)}"]`) : null)
  return own ?? (found && (!found.closest('form') || found.closest('form') === form) ? found : null)
}

/** One field a refusal named: its box's id, its label and what is wrong with it. */
export type Problem = { id: string; label: string; sentence: string }

/**
 * The fields a save was refused over, listed at the top of the form, each a link to its box, as GOV.UK's error
 * summary is. It takes the focus each time a save is refused, so a reader hears what to fix wherever they pressed it.
 */
export function ErrorSummary({ problems, refused, t }: { problems: readonly Problem[]; refused: number; t: Translate }): ReactElement | null {
  const summary = useRef<HTMLDivElement>(null)
  // After the commit, not inside it: opening a tab is a press the tab handles with its own synchronous render.
  useEffect(() => {
    if (!refused || !problems.length) return
    const timer = setTimeout(() => reveal(summary.current))
    return () => clearTimeout(timer)
  }, [refused])
  if (!problems.length) return null
  return (
    <div ref={summary} tabIndex={-1} role="alert" data-error-summary="" className="border-destructive/50 text-destructive rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/20">
      <p className="font-medium">{t('admin.errorSummary', 'Check these fields:')}</p>
      <ul className="mt-1 list-disc ps-5">
        {problems.map((one) => (
          <li key={one.id}>
            <a
              href={`#${one.id}`}
              className="underline underline-offset-4"
              onClick={(event) => {
                event.preventDefault()
                reveal(boxOf(event.currentTarget, one.id))
              }}
            >
              {one.label}: {one.sentence}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What a form draws above its fields: its title and sentence, the summary of the fields a save was refused over,
 * the draft or published switch below xl, and what a changed row says.
 */
export function FormChrome({ about, draft, headed, problems, refused, stale, t, title, views }: {
  /** Whether the form draws a header at all: on a screen's page a kayan with no sentence draws none, and no rule under it. */
  headed: boolean
  /** The heading, which a screen's page leaves to its own `title` node. */
  title?: string
  about?: string
  problems: readonly Problem[]
  /** How many saves have been refused over fields, which moves the focus to the summary on each. */
  refused: number
  /** What the form says once its row changed elsewhere, which stays until the page is read again. */
  stale?: string
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
          <PageHeader t={t} title={title === undefined ? null : <h1 className="text-2xl font-bold tracking-tight">{title}</h1>} />
          {about ? <p className="text-muted-foreground mt-1 text-sm">{about}</p> : null}
        </header>
      ) : null}
      {stale ? (
        <div role="alert" data-stale-notice="" className="border-destructive/50 text-destructive flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <p className="min-w-0 flex-1">{stale}</p>
          <Button type="button" variant="outline" size="sm" data-button="reload" onClick={() => window.location.reload()}>{t('admin.reload', 'Reload')}</Button>
        </div>
      ) : null}
      <ErrorSummary problems={problems} refused={refused} t={t} />
      {views ? <ViewSwitch className="xl:hidden" phone {...views} t={t} /> : null}
      {draft ? <DraftBanner {...draft} t={t} /> : null}
    </>
  )
}
