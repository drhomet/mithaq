import { useState, type ComponentProps } from 'react'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { organizations, signUp, verifyEmail } from 'asas/organizations'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { documentHead } from '../copy.ts'
import { AuthBox, AuthForm, AuthFrame, authGate, gate, notAnEmail, redirectSearch, useRefusal } from '../auth-frame.tsx'
import { firstRun } from '../first-run.ts'
import { landing, wanted } from '../redirect.ts'
import { useCopy } from './__root.tsx'

export const Route = createFileRoute('/auth/sign-up')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.signUp')),
  validateSearch: redirectSearch,
  // An app of one organization that has none yet takes no account before its owner's.
  beforeLoad: async ({ search }: { search: { redirect?: string } }) => {
    if ((await firstRun()).open) throw redirect({ href: '/auth/first-run' })
    return gate({ search })
  },
  component: SignUp,
})

/**
 * Whether a new account proves its address before it signs in, so the sign-up answers with no session: with many
 * organizations always, where the person then founds or joins one, and with one where an open sign-up says so. Such a
 * sign-up asks no password: it is chosen once, on the page the mailed link opens, and the server keeps none typed here.
 */
const verifies = signUp === 'open' && verifyEmail

function SignUp() {
  const navigate = useNavigate()
  const { t } = useCopy()
  const search = Route.useSearch()
  const refused = useRefusal()
  const { password: bounds } = Route.useRouteContext()
  // The redirect is a link anyone can write; a crafted one only makes an account with no organization,
  // which reads nothing until an organization invites it.
  const asked = wanted({ asked: search.redirect, home: '/' })
  const invited = asked.startsWith('/auth/accept-invitation?')
  // The invitation's id, which a sign-up by invitation carries: holding it is what lets it through.
  const invitationId = invited ? new URLSearchParams(asked.slice(asked.indexOf('?'))).get('id') ?? undefined : undefined
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
  const [sent, setSent] = useState<string | null>(null)
  const required = t('auth.required', 'This field is required.')
  const named = {
    name: () => (name ? undefined : required),
    email: () => (!email ? required : notAnEmail(email) ? t('auth.invalidEmail', 'Invalid email') : undefined),
  }
  const chosen = {
    password: () =>
      !password ? required
      : password.length < bounds.min ? t('auth.passwordTooShort', 'Password too short')
      : password.length > bounds.max ? t('auth.passwordTooLong', 'Password too long')
      : undefined,
    confirmation: () => (!confirmation ? required : confirmation === password ? undefined : t('auth.passwordsDiffer', 'The two passwords are not the same.')),
  }
  const wrong: Partial<Record<'name' | 'email' | 'password' | 'confirmation', () => string | undefined>> = verifies ? named : { ...named, ...chosen }
  const errorOf = (box: keyof typeof wrong) => (left.has(box) ? wrong[box]?.() : undefined)
  const box = (id: keyof typeof wrong, label: string | undefined, props: ComponentProps<'input'> & { description?: string }) => (
    <AuthBox id={id} label={label} error={errorOf(id)} onLeave={() => setLeft((already) => new Set(already).add(id))} {...props} />
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLeft(new Set(Object.keys(wrong)))
    if (Object.values(wrong).some((check) => check())) return
    setPending(true)
    setRefusal(null)
    const made = await authArm('sign-up/email', { name, email, ...(!verifies && { password }), ...(invitationId && { invitationId }) })
    setPending(false)
    if (!made.ok) return setRefusal(refused(made, t('auth.signUpFailed', 'That sign-up did not work.')))
    // An account that proves its address first has no session yet, invited or not, so it is told to open its mail.
    if (verifies) return setSent(email)
    // The server accepted the invitation the sign-up carried, so its page would only say it is spent.
    await navigate({ href: landing({ asked: invited ? undefined : search.redirect, screens: (await authGate()).screens }) })
  }

  const toSignIn = (
    <p className="mt-4 text-center text-sm text-muted-foreground">
      {t('auth.haveAccount', 'Already have an account?')}{' '}
      <Link className="text-primary underline underline-offset-4" to="/auth/sign-in" search={{ redirect: search.redirect }}>
        {t('auth.signIn', 'Sign in')}
      </Link>
    </p>
  )
  // By invitation, nobody without one is offered a form the server would refuse.
  if (organizations === 'one' && signUp === 'invite' && !invitationId) {
    return (
      <AuthFrame title={t('auth.signUp', 'Sign up')} description={t('auth.inviteOnly', 'Accounts here are made by invitation. Open the link of the invitation sent to you, or sign in.')}>
        {toSignIn}
      </AuthFrame>
    )
  }
  if (sent) {
    return (
      <AuthFrame
        title={t('auth.verifySent', 'Check your email')}
        description={<span className="[overflow-wrap:anywhere]">{t('auth.verifySentDescription', 'We sent a link to {email}. Open it to confirm your address and choose your password, then sign in. It lasts an hour.')!.split(/(\{email\})/).map((part, at) => (part === '{email}' ? <bdi key={at}>{sent}</bdi> : part))}</span>}
      >
        {toSignIn}
      </AuthFrame>
    )
  }
  return (
    <AuthFrame
      title={t('auth.signUp', 'Sign up')}
      description={invited ? t('auth.signUpInvitedDescription', 'Make an account with the email address the invitation was sent to.') : t('auth.signUpDescription', 'Make an account.')}
    >
      <AuthForm className="grid gap-4" noValidate onSubmit={submit}>
        {box('name', t('auth.name', 'Name'), { autoComplete: 'name', onChange: (event) => setName(event.target.value), type: 'text', value: name })}
        {box('email', t('auth.email', 'Email'), { autoComplete: 'email', onChange: (event) => setEmail(event.target.value), type: 'email', value: email })}
        {verifies ? null : box('password', t('auth.password', 'Password'), {
          autoComplete: 'new-password',
          description: t('auth.passwordRule', 'At least {count} characters.')!.replace('{count}', String(bounds.min)),
          onChange: (event) => setPassword(event.target.value),
          type: 'password',
          value: password,
        })}
        {verifies ? null : box('confirmation', t('auth.confirmPassword', 'Confirm the password'), {
          autoComplete: 'new-password',
          onChange: (event) => setConfirmation(event.target.value),
          type: 'password',
          value: confirmation,
        })}
        {refusal && (
          <p className="text-destructive text-sm" role="alert">
            {refusal}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {pending ? t('auth.signUpPending', 'Signing up…') : t('auth.signUp', 'Sign up')}
        </Button>
      </AuthForm>
      {toSignIn}
    </AuthFrame>
  )
}
