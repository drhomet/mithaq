import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { documentHead } from '../copy.ts'
import { AuthFrame, authGate, useHomeLabel, useRefusal } from '../auth-frame.tsx'
import { useCopy } from './__root.tsx'

// Accepting is a POST the person presses, so following a link alone joins nobody to anything.
// The provider decides whether the invitation is theirs.

export const Route = createFileRoute('/auth/accept-invitation')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.invitation')),
  validateSearch: (search: Record<string, unknown>): { id?: string } => (typeof search.id === 'string' && search.id ? { id: search.id } : {}),
  beforeLoad: () => authGate(),
  component: AcceptInvitation,
})

function AcceptInvitation() {
  const { t } = useCopy()
  const navigate = useNavigate()
  const refused = useRefusal()
  const { id } = Route.useSearch()
  const { signedIn, home } = Route.useRouteContext()
  const homeLabel = useHomeLabel()
  const [organization, setOrganization] = useState<string>()
  const [gone, setGone] = useState<string>()
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string>()
  const title = t('auth.invitation', 'Invitation')

  useEffect(() => {
    if (!signedIn || !id) return
    fetch(`/api/auth/user/organization/get-invitation?id=${encodeURIComponent(id)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { organizationName?: string; code?: unknown } | null
        if (response.ok) return setOrganization(body?.organizationName ?? '')
        // Better Auth answers a missing, spent or expired invitation 400 with no code.
        setGone(refused({ status: response.status, body }, t('auth.invitationGone', 'This invitation has expired, was cancelled or was already accepted. Ask whoever invited you to send a new one.')))
      })
      .catch(() => setGone(t('auth.requestFailed', 'That request did not work.')))
  }, [signedIn, id])

  const accept = async () => {
    setPending(true)
    setRefusal(undefined)
    const answered = await authArm('organization/accept-invitation', { invitationId: id })
    if (!answered.ok) {
      setPending(false)
      return setRefusal(refused(answered, t('auth.invitationAcceptFailed', 'That invitation could not be accepted.')))
    }
    // The provider made the organization active as it accepted, so the first screen is read as a member.
    await navigate({ to: (await authGate()).home.path })
  }

  if (!id) return <AuthFrame title={title} description={t('auth.invitationMissing', 'This link names no invitation.')}>{null}</AuthFrame>
  if (!signedIn) {
    const here = `/auth/accept-invitation?id=${encodeURIComponent(id)}`
    return (
      <AuthFrame title={title} description={t('auth.invitationSignedOut', 'Sign in, or make an account with the email address the invitation was sent to, to accept it.')}>
        <div className="grid gap-2">
          <Button nativeButton={false} render={<Link to="/auth/sign-in" search={{ redirect: here }} />}>
            {t('auth.signIn', 'Sign in')}
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/auth/sign-up" search={{ redirect: here }} />}>
            {t('auth.signUp', 'Sign up')}
          </Button>
        </div>
      </AuthFrame>
    )
  }
  if (gone) {
    return (
      <AuthFrame title={title}>
        <div className="grid gap-4">
          <p role="alert" data-invitation-gone="" className="text-sm">
            {gone}
          </p>
          {/* A spent invitation is no dead end for someone already in: the way to their own first screen. An anchor,
              because the path is the screen's own data, not a route the router knows. */}
          <Button nativeButton={false} render={<a href={home.path} data-home="" />}>
            {homeLabel(home, 'marketing.openScreen')}
          </Button>
          {/* The invitation may be another address's, which signing out and in again reaches. */}
          <Button type="button" variant="outline" onClick={() => void authArm('sign-out').then(() => window.location.reload())}>
            {t('admin.signOut', 'Sign out')}
          </Button>
        </div>
      </AuthFrame>
    )
  }
  if (organization === undefined) return <AuthFrame title={title} description={t('auth.invitationReading', 'Reading the invitation…')}>{null}</AuthFrame>
  return (
    <AuthFrame title={title} description={t('auth.invitationJoin', 'You are invited to join {organization}.')!.replace('{organization}', () => organization)}>
      <div className="grid gap-4">
        {refusal ? (
          <p className="text-destructive text-sm" role="alert">
            {refusal}
          </p>
        ) : null}
        <Button type="button" data-button="accept-invitation" disabled={pending} onClick={() => void accept()}>
          {pending ? t('auth.invitationAccepting', 'Accepting…') : t('auth.invitationAccept', 'Accept the invitation')}
        </Button>
      </div>
    </AuthFrame>
  )
}
