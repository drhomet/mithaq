// What `/unauthorized` draws below its sentence for a person who belongs to no organization: the invitations sent to
// their address, and with many organizations a way to found one. The screen host imports it from the app, which knows
// the organization mode the host does not.
import { useEffect, useState } from 'react'
import { defaultLocale, organizations } from 'asas/organizations'
import { endonym } from 'mithaq-admin/locale-menu.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authArm } from './api.ts'
import { useRefusal } from './auth-frame.tsx'
import { locales } from './copy.ts'
import { useCopy } from './routes/__root.tsx'

/** An invitation as the auth setup answers it: the organization's name in each locale beside the provider's one. */
type Invitation = { id: string; organizationName: string; organizationNames?: Record<string, string>; expiresAt: string }

/**
 * Better Auth requires a unique slug, so a random tail keeps same-named organizations apart.
 * Padded before the cut, so the tail is always six characters and the slug never ends in `-`.
 */
const slugOf = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'organization'}-${Math.random().toString(36).slice(2).padEnd(6, '0').slice(0, 6)}`

/** Signing in again lands a signed-in person on their first screen, in the organization the session now names. */
const goIn = () => window.location.assign('/auth/sign-in')

export function NoOrganization({ email, founds = organizations === 'many' }: { email: string | undefined; founds?: boolean }) {
  const { t, locale } = useCopy()
  const refusal = useRefusal()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [name, setName] = useState('')
  // The organization's name in each other locale, optional: one left empty falls back to `name`.
  const [names, setNames] = useState<Record<string, string>>({})
  const others = locales.filter((one) => one !== defaultLocale)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    // A refusal, such as an address nobody proved, reads as no invitation.
    void fetch('/api/auth/user/organization/list-user-invitations').then(async (answer) => {
      if (answer.ok) setInvitations(((await answer.json()) as Invitation[]).filter((one) => new Date(one.expiresAt).getTime() > Date.now()))
    })
    if (founds) {
      void fetch('/api/auth/user/get-session').then(async (answer) => {
        const named = ((await answer.json().catch(() => null)) as { user?: { name?: string } } | null)?.user?.name
        if (named) setName((typed) => typed || t('auth.workspaceOf', '{name}\'s workspace')!.replace('{name}', () => named))
      })
    }
  }, [])
  /** One request at a time, its refusal said in this app's words. */
  const send = async ({ path, body, done }: { path: string; body: Record<string, unknown>; done: () => void }) => {
    setBusy(true)
    setFailed(undefined)
    const answered = await authArm(path, body)
    setBusy(false)
    if (!answered.ok) return setFailed(refusal(answered, t('auth.requestFailed', 'That request did not work.')))
    done()
  }
  return (
    <div data-no-organization="" className="grid gap-4">
      {invitations.length ? (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium">{t('auth.yourInvitations', 'Your invitations')}</h2>
          <ul className="grid gap-2">
            {invitations.map((one) => (
              <li key={one.id} data-invitation={one.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                <bdi className="[overflow-wrap:anywhere]">{one.organizationNames?.[locale] || one.organizationName}</bdi>
                <span className="flex gap-2">
                  <Button type="button" size="sm" data-accept={one.id} disabled={busy} onClick={() => void send({ path: 'organization/accept-invitation', body: { invitationId: one.id }, done: goIn })}>
                    {t('auth.invitationAccept', 'Accept the invitation')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" data-decline={one.id} disabled={busy} onClick={() => void send({ path: 'organization/reject-invitation', body: { invitationId: one.id }, done: () => setInvitations((all) => all.filter((other) => other.id !== one.id)) })}>
                    {t('auth.invitationDecline', 'Decline')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {founds ? (
        <form method="post"
          data-create-organization=""
          className="grid gap-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const named = { [defaultLocale]: name.trim(), ...Object.fromEntries(others.map((one) => [one, names[one]?.trim() ?? '']).filter(([, one]) => one)) }
            if (name.trim()) void send({ path: 'organization/create', body: { name: name.trim(), names: JSON.stringify(named), slug: slugOf(name.trim()) }, done: goIn })
          }}
        >
          <label htmlFor="new-organization" className="text-sm font-medium">{t('auth.createOrganization', 'Create an organization')}</label>
          <Input id="new-organization" value={name} maxLength={100} autoComplete="organization" dir="auto" onChange={(event) => setName(event.target.value)} />
          {others.map((one) => (
            <div key={one} className="grid gap-1">
              <label htmlFor={`new-organization-${one}`} className="text-muted-foreground text-sm">{t('auth.organizationNameIn', 'Its name in {language}, if it has one')!.replace('{language}', () => endonym(one))}</label>
              <Input id={`new-organization-${one}`} lang={one} dir="auto" value={names[one] ?? ''} maxLength={100} onChange={(event) => setNames((held) => ({ ...held, [one]: event.target.value }))} />
            </div>
          ))}
          <Button type="submit" disabled={busy || !name.trim()}>{t('auth.createOrganizationSubmit', 'Create')}</Button>
        </form>
      ) : null}
      <p className="text-muted-foreground text-sm">
        {t('auth.askToBeInvited', 'Ask an administrator to invite {email}.')!.split(/(\{email\})/).map((part, at) => (part === '{email}' ? <bdi key={at} className="[overflow-wrap:anywhere]">{email}</bdi> : part))}
      </p>
      {failed ? <p role="alert" className="text-destructive text-sm">{failed}</p> : null}
    </div>
  )
}
