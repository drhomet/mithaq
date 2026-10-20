import { use, useEffect, useState, type ReactElement } from 'react'
import { Check } from 'lucide-react'
import { PageActionTarget, PageBreadcrumb } from 'mithaq-admin/page-header.tsx'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { Translate } from 'mithaq-admin/copy.ts'
import type { DraftStatus } from 'mithaq-admin/form-types.tsx'

/** Which copy of a changed row the form shows, and how to show the other. */
export type Views = { viewing: boolean; choose: (next: string) => Promise<void> }

export type FormActionsProps = {
  /** Whether this is the page header's row, which holds the refusal and the status pill, rather than the foot of the form. */
  header: boolean
  t: Translate
  locale: string
  status?: DraftStatus
  /** The draft or published switch, on a changed row whose host can read the published copy. */
  views?: Views
  autosaved?: 'saving' | 'saved'
  /** When the row was last updated, on an update. */
  updated?: Date
  busy: boolean
  dirty: boolean
  /** Whether the form changes a row rather than makes one. */
  updating: boolean
  /** Whether the form shows the published copy, which takes no save. */
  viewing: boolean
  /** Whether the kayan keeps drafts, which draws Save draft and Publish in place of Save. */
  drafts: boolean
  /** Whether the form saves its draft as the person types, which leaves Cancel nothing to cancel. */
  autosaves?: boolean
  /** The id of the form a submit button names, since a controls node draws the row outside it. */
  formId: string
  /** Asks before an unsaved edit is left. */
  onAsk: () => void
  onCancel?: () => void
  onSaveDraft: () => void
}

const pills: Record<DraftStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  changed: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

const publishColour = 'bg-emerald-700 text-white hover:bg-emerald-700/90 focus-visible:border-emerald-600 focus-visible:ring-emerald-600/40 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-500/90 dark:focus-visible:ring-emerald-500/40'
const draftColour = 'border-transparent bg-amber-500 text-amber-950 hover:bg-amber-500/90 hover:text-amber-950 focus-visible:border-amber-600 focus-visible:ring-amber-500/50 dark:bg-amber-400 dark:hover:bg-amber-400/90'

const units = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]] as const

/** How long ago a moment was, in the viewer's language via `Intl.RelativeTimeFormat`: "2 hours ago", and "now" for the moment just passed or a moment ahead of this clock. */
export const timeAgo = ({ at, now, locale }: { at: Date; now: number; locale: string }) => {
  const seconds = Math.min(0, (at.getTime() - now) / 1000)
  const [unit, size] = units.find(([, size]) => -seconds >= size) ?? units.at(-1)!
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit)
}

function UpdatedAgo({ at, t, locale }: { at: Date; t: Translate; locale: string }): ReactElement {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])
  return <>{(t('version.updatedAgo', 'Updated {time}') ?? 'Updated {time}').replace('{time}', timeAgo({ at, now, locale }))}</>
}

// Below sm the action bar is fixed, so the document keeps its height free as padding and scroll padding
// (the document is what scrolls), and a field reached with Tab is never under the bar.
const measureBar = (bar: HTMLElement | null) => {
  // Inside a sheet or a dialog the bar is the popup's own, so the document keeps no room for it.
  if (!bar || bar.closest('[role=dialog]')) return
  const root = document.documentElement.style
  // `--action-bar-height` too, which a list's own bar on a phone stands on rather than covering this one.
  const keep = (height: number) => {
    for (const property of ['padding-bottom', 'scroll-padding-bottom', '--action-bar-height']) {
      if (height) root.setProperty(property, `${height}px`)
      else root.removeProperty(property)
    }
  }
  // `borderBoxSize` is missing before Safari 15.4 and one box rather than a
  // list before Firefox 92, so the bar's own `offsetHeight` stands in there.
  const observer = new ResizeObserver(([entry]) => keep(entry ? (entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight) : 0))
  observer.observe(bar)
  return () => {
    observer.disconnect()
    keep(0)
  }
}

/** The switch between a changed row's draft and its published copy. */
export function ViewSwitch({ className, phone = false, viewing, choose, t }: { className: string; phone?: boolean } & Views & { t: Translate }): ReactElement {
  return (
    <ToggleGroup
      data-view-switch=""
      value={[viewing ? 'published' : 'draft']}
      onValueChange={(next) => next[0] && void choose(next[0])}
      aria-label={t('version.shownCopy', 'Version shown')}
      className={`bg-muted flex shrink-0 rounded-md p-0.5 ${className}`}
    >
      {(['draft', 'published'] as const).map((one) => (
        <ToggleGroupItem key={one} value={one} className={`data-pressed:bg-background border-0 px-2 py-0.5 text-xs data-pressed:shadow-sm${phone ? ' min-h-11 flex-1' : ''}`}>
          {t(`version.${one}`, { draft: 'Draft', published: 'Published' }[one])}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

// A submit button in a controls node sits outside the <form>, so every submit names it by its id. The spacing is
// logical, so the row mirrors in Arabic.
export function FormActions({
  autosaved,
  autosaves,
  busy,
  dirty,
  drafts,
  formId,
  header,
  locale,
  onAsk,
  onCancel,
  onSaveDraft,
  status,
  t,
  updated,
  updating,
  viewing,
  views,
}: FormActionsProps): ReactElement {
  const breadcrumb = use(PageBreadcrumb)
  const actionTarget = use(PageActionTarget)
  const size = header ? 'sm' : 'default'
  const tall = header ? 'max-sm:h-11' : ''
  const actions = (
    <>
      {status && !header ? (
        <span data-status={status} className={`me-auto rounded-md px-2 py-0.5 text-sm ${pills[status]}`}>
          {t('version.status', 'Status')}: {t(`version.${status}`, { draft: 'Draft', published: 'Published', changed: 'Changed' }[status])}
        </span>
      ) : null}
      {/* Below xl it leaves the header for the top of the form (`chrome`). */}
      {views ? <ViewSwitch className={header ? 'max-xl:hidden' : ''} {...views} t={t} /> : null}
      {autosaved ? (
        <span
          role="status"
          data-autosave={autosaved}
          className={autosaved === 'saved'
            ? 'animate-out fade-out fill-mode-forwards delay-1500 animation-duration-500 flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400'
            : 'text-muted-foreground text-sm'}
        >
          {autosaved === 'saved' ? <Check aria-hidden className="size-4" /> : null}
          {autosaved === 'saving' ? t('version.saving', 'Saving…') : t('version.saved', 'Saved')}
        </span>
      ) : null}
      {/* Read off the browser's clock, so it can differ from the server's render. */}
      {header && updated && !Number.isNaN(updated.getTime()) ? (
        <span data-updated="" className="text-muted-foreground text-sm max-xl:hidden" suppressHydrationWarning>
          <UpdatedAgo at={updated} t={t} locale={locale} />
        </span>
      ) : null}
      {/* A dirty form asks before Cancel: the router's navigation raises no `beforeunload`, so the browser's
          guard does not see it. A clean form's Cancel is a plain button. */}
      {onCancel && !(autosaves && breadcrumb) ? (
        <Button
          type="button"
          variant="outline"
          size={size}
          className={tall}
          disabled={busy}
          aria-haspopup={dirty ? 'dialog' : undefined}
          onClick={dirty ? onAsk : onCancel}
        >
          {/* A draft that saves itself is kept on the way out, so the button says where it goes. */}
          {autosaves ? (t('admin.backToList', 'Back to list') ?? 'Back to list') : (t('admin.cancel', 'Cancel') ?? 'Cancel')}
        </Button>
      ) : null}
      {viewing ? null : drafts ? (
        <>
          {/* Save draft waits for a change on an update and is always offered beside the autosave. Publish is
              offered while anything is unpublished, with no change of its own. */}
          <Button type="button" size={size} className={`${draftColour} ${tall}`} data-button="save-draft" disabled={busy || autosaved === 'saving' || (updating && !dirty)} onClick={onSaveDraft}>
            {t('version.saveDraft', 'Save draft')}
          </Button>
          <Button type="submit" form={formId} size={size} className={`${publishColour} ${tall}`} data-button="publish" disabled={busy || autosaved === 'saving' || (!dirty && status === 'published')}>
            {busy ? <Spinner /> : null}
            {/* Changes are what a published record has; a record never published is published whole. */}
            {status === 'published' || status === 'changed' ? t('version.publishChanges', 'Publish changes') : t('version.publish', 'Publish')}
          </Button>
        </>
      ) : (
        // Waits for a change on an update alone: a create is pressed to be checked.
        <Button type="submit" form={formId} size={size} className={tall} disabled={busy || (updating && !dirty)}>
          {busy ? <Spinner /> : null}
          {t('admin.save', 'Save')}
        </Button>
      )}
    </>
  )
  // `flex-wrap`: a row that cannot wrap is as wide as all its buttons together, which widens every grid
  // and flex box above it past a phone's width.
  if (!header) return <div className="flex flex-wrap items-center justify-end gap-2 rtl:justify-start">{actions}</div>
  // Below sm the header keeps the trigger, title and pill, and the rest moves to a bar fixed to the bottom of the
  // screen; from sm up the bar is `contents`. Inside a sheet or dialog the row sticks to the popup's foot instead.
  return (
    <div className="ms-auto flex min-w-min items-center justify-end gap-2 sm:flex-wrap max-sm:in-[[role=dialog]]:bg-background max-sm:in-[[role=dialog]]:sticky max-sm:in-[[role=dialog]]:bottom-0 max-sm:in-[[role=dialog]]:z-20 max-sm:in-[[role=dialog]]:order-last max-sm:in-[[role=dialog]]:w-full max-sm:in-[[role=dialog]]:border-t">
      {/* Coloured by status and always carrying its word, never the colour alone. The row shrinks no further
          than the narrowest it can be drawn, so the title beside it wraps rather than sitting under it. */}
      {status ? (
        <Badge data-status={status} className={pills[status]} title={t('version.status', 'Status')}>
          {t(`version.${status}`, { draft: 'Draft', published: 'Published', changed: 'Changed' }[status])}
        </Badge>
      ) : null}
      <div
        data-action-bar=""
        ref={measureBar}
        className="max-sm:bg-background max-sm:fixed max-sm:in-[[role=dialog]]:static max-sm:in-[[role=dialog]]:flex-1 max-sm:in-[[role=dialog]]:border-t-0 max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:justify-end max-sm:gap-2 max-sm:border-t max-sm:px-4 max-sm:pt-2 max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:contents"
      >
        {actions}
        {actionTarget ? <span ref={actionTarget} className="contents" /> : null}
      </div>
    </div>
  )
}
