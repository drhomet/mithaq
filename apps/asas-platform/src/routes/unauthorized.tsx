import { Fragment, useState, type ReactNode } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { AuthFrame, useRefusal } from '../auth-frame.tsx'
import { documentHead } from '../copy.ts'
import { ImpersonationBar, loadEnterable } from '../screens.tsx'
import { useCopy } from './__root.tsx'

export const Route = createFileRoute('/unauthorized')({
  // The path a screen refused; the server only matches it against the build's pages.
  validateSearch: (search: Record<string, unknown>): { from?: string } => (typeof search.from === 'string' ? { from: search.from } : {}),
  loaderDeps: ({ search }) => ({ from: search.from }),
  loader: async ({ deps, context }) => {
    const entered = await loadEnterable({ data: { from: deps.from, locale: context.locale } })
    // Carries this page's own path so a visitor whose session expired lands back here after signing in.
    if (!entered) throw redirect({ to: '/auth/sign-in', search: { redirect: '/unauthorized' } })
    return entered
  },
  // After the loader, so its data's type is inferred before this reads it.
  head: ({ match, loaderData }) => documentHead(match.context, (t) => (loaderData?.screens.length === 0 ? t('auth.noAccess') : t('auth.unauthorized'))),
  component: Unauthorized,
})

function Unauthorized() {
  const { t } = useCopy()
  const { screens, refused, email, impersonating, organizations = [], others = [] } = Route.useLoaderData()
  const refusal = useRefusal()
  const [switching, setSwitching] = useState<string>()
  const [failed, setFailed] = useState<string>()
  // The slug sits beside the name where another membership shares the name.
  const memberships = [...organizations, ...others]
  const named = (one: { id: string; name: string; slug?: string }): ReactNode =>
    one.slug && memberships.some((other) => other.id !== one.id && other.name === one.name) ? (
      <>
        {one.name} <span dir="ltr" data-slug="" className="text-muted-foreground text-xs font-normal">{one.slug}</span>
      </>
    ) : (
      one.name
    )
  // Each name is isolated so an email or Latin name in an Arabic sentence keeps
  // its order, and is one inline box that wraps whole, so a long address never
  // runs past the card on a phone.
  const whole = 'inline-block max-w-full [overflow-wrap:anywhere]'
  const said = (text: string | undefined) =>
    text!.split(/(\{email\}|\{organization\}|\{page\})/).map((part, at) =>
      part === '{email}' ? <bdi key={at} className={whole}>{email}</bdi>
      : part === '{organization}' ? <bdi key={at}>{organizations.map((one, index) => <Fragment key={one.id}>{index ? ', ' : ''}<span className={whole}>{named(one)}</span></Fragment>)}</bdi>
      : part === '{page}' ? <bdi key={at}>{refused?.page}</bdi>
      : part)
  const link = 'text-foreground underline underline-offset-4'
  const screenName = (name: string) => t(`screens.${name}`, name) ?? name
  return (
    <AuthFrame
      title={screens.length ? t('auth.unauthorized', 'Not for your role') : t('auth.noAccess', 'Your account has no access yet')}
      description={
        <span data-no-access={screens.length ? undefined : ''}>
          {refused
            ? said(t('auth.unauthorizedPage', 'Your role does not open that page: {page}.'))
            : screens.length
              ? t('auth.unauthorizedDescription', 'Your role does not open that screen. These are the screens it opens:')
              : organizations.length
                ? said(t('auth.noAccessDescription', '{email} is a member of {organization} and holds no role that opens a screen here. Ask an administrator of {organization} to give you one.'))
                : said(t('auth.noOrganization', '{email} belongs to no organization yet. Ask an administrator to invite you.'))}
        </span>
      }
    >
      <div className="grid gap-4">
        {/* Stopping impersonation is the way out in place of Sign out. */}
        {impersonating ? <ImpersonationBar name={impersonating} /> : null}
        {refused ? (
          <a className={link} href={refused.screen.path}>
            {(t('auth.backTo', 'Back to {screen}') ?? 'Back to {screen}').replace('{screen}', () => screenName(refused.screen.name))}
          </a>
        ) : screens.length ? (
          <ul className="grid gap-2">
            {screens.map((screen) => (
              <li key={screen.name}>
                {/* An anchor: the path is the screen's own data, not a route the router knows. */}
                <a className={link} href={screen.path}>
                  {screenName(screen.name)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {/* So a switch into an organization where the actor holds no role is not a dead end. */}
        {others.map((one) => (
          <Button
            key={one.id}
            type="button"
            variant="secondary"
            data-switch-organization={one.id}
            // Busy while it runs, so a second press sends nothing.
            disabled={switching !== undefined}
            aria-busy={switching === one.id || undefined}
            onClick={() => {
              setSwitching(one.id)
              setFailed(undefined)
              void authArm('organization/set-active', { organizationId: one.id }).then((answer) => {
                if (answer.ok) return window.location.assign('/auth/sign-in')
                setSwitching(undefined)
                setFailed(refusal(answer, t('auth.requestFailed', 'That request did not work.')))
              })
            }}
          >
            {/* One box, so the button's gap does not open beside the name. */}
            <span>{(t('auth.switchTo', 'Switch to {organization}') ?? 'Switch to {organization}').split(/(\{organization\})/).map((part, at) => (part === '{organization}' ? <bdi key={at}>{named(one)}</bdi> : part))}</span>
          </Button>
        ))}
        {failed ? <p role="alert" className="text-destructive text-sm">{failed}</p> : null}
        {/* `replace`, so Back does not return to the page signed out of. */}
        {impersonating ? null : (
          <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => void authArm('sign-out').then(() => window.location.replace('/auth/sign-in'))}>
            {t('admin.signOut', 'Sign out')}
          </Button>
        )}
      </div>
    </AuthFrame>
  )
}
// mithaq-admin 2d3ab739c92c6c2b397041b76bf4b23b2902b7a2 3c5c304b3892c56759bf780f155ef3aa154ce3cc954e3d240b3537cdd97da735
