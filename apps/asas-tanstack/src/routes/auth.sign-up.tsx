import { useState, type ComponentProps } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { documentHead } from '../copy.ts'
import { AuthBox, AuthFrame, authGate, gate, notAnEmail, redirectSearch, useRefusal } from '../auth-frame.tsx'
import { wanted } from '../redirect.ts'
import { useCopy } from './__root.tsx'

export const Route = createFileRoute('/auth/sign-up')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.signUp')),
  validateSearch: redirectSearch,
  beforeLoad: gate,
  component: SignUp,
})

/**
 * Better Auth requires a unique slug, so a random tail keeps same-named organizations apart.
 * Padded before the cut, so the tail is always six characters and the slug never ends in `-`.
 */
const slugOf = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'organization'}-${Math.random().toString(36).slice(2).padEnd(6, '0').slice(0, 6)}`

function SignUp() {
  const navigate = useNavigate()
  const { t } = useCopy()
  const search = Route.useSearch()
  const refused = useRefusal()
  const { password: bounds } = Route.useRouteContext()
  // The redirect is a link anyone can write; a crafted one only makes an account with no organization,
  // which reads nothing until an organization invites it.
  const invited = wanted({ asked: search.redirect, home: '/' }).startsWith('/auth/accept-invitation?')
  const [name, setName] = useState('')
  const [organization, setOrganization] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The address this submit already signed up. A second sign-up with the same email is refused, so a
  // retry after the organization call failed must skip it. An address and not a flag: a corrected typo signs up again.
  const [signedUpAs, setSignedUpAs] = useState<string | null>(null)
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
  const required = t('auth.required', 'This field is required.')
  const wrong = {
    name: () => (name ? undefined : required),
    organization: () => (invited || organization ? undefined : required),
    email: () => (!email ? required : notAnEmail(email) ? t('auth.invalidEmail', 'Invalid email') : undefined),
    password: () =>
      !password ? required
      : password.length < bounds.min ? t('auth.passwordTooShort', 'Password too short')
      : password.length > bounds.max ? t('auth.passwordTooLong', 'Password too long')
      : undefined,
    confirmation: () => (!confirmation ? required : confirmation === password ? undefined : t('auth.passwordsDiffer', 'The two passwords are not the same.')),
  }
  const errorOf = (box: keyof typeof wrong) => (left.has(box) ? wrong[box]() : undefined)
  const box = (id: keyof typeof wrong, label: string | undefined, props: ComponentProps<'input'> & { description?: string }) => (
    <AuthBox id={id} label={label} error={errorOf(id)} onLeave={() => setLeft((already) => new Set(already).add(id))} {...props} />
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLeft(new Set(Object.keys(wrong)))
    if (Object.values(wrong).some((check) => check())) return
    setPending(true)
    setRefusal(null)
    if (signedUpAs !== email) {
      const made = await authArm('sign-up/email', { name, email, password })
      if (!made.ok) {
        setPending(false)
        return setRefusal(refused(made, t('auth.signUpFailed', 'That sign-up did not work.')))
      }
      setSignedUpAs(email)
    }
    // A refusal here leaves an account that reads nothing, so the sentence names the organization;
    // `signedUpAs` holds a retry to this call.
    const created = invited ? undefined : await authArm('organization/create', { name: organization, slug: slugOf(organization) })
    setPending(false)
    if (created && !created.ok) return setRefusal(refused(created, t('auth.organizationFailed', 'That organization could not be created.')))
    await navigate({ to: wanted({ asked: search.redirect, home: (await authGate()).home.path }) })
  }

  return (
    <AuthFrame
      title={t('auth.signUp', 'Sign up')}
      description={invited ? t('auth.signUpInvitedDescription', 'Make an account with the email address the invitation was sent to.') : t('auth.signUpDescription', 'Make an account and its organization.')}
    >
      <form className="grid gap-4" noValidate onSubmit={submit}>
        {box('name', t('auth.name', 'Name'), { autoComplete: 'name', onChange: (event) => setName(event.target.value), type: 'text', value: name })}
        {invited ? null : box('organization', t('auth.organization', 'Organization'), { autoComplete: 'organization', onChange: (event) => setOrganization(event.target.value), type: 'text', value: organization })}
        {box('email', t('auth.email', 'Email'), { autoComplete: 'email', onChange: (event) => setEmail(event.target.value), type: 'email', value: email })}
        {box('password', t('auth.password', 'Password'), {
          autoComplete: 'new-password',
          description: t('auth.passwordRule', 'At least {count} characters.')!.replace('{count}', String(bounds.min)),
          onChange: (event) => setPassword(event.target.value),
          type: 'password',
          value: password,
        })}
        {box('confirmation', t('auth.confirmPassword', 'Confirm the password'), {
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
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t('auth.haveAccount', 'Already have an account?')}{' '}
        <Link className="text-primary underline underline-offset-4" to="/auth/sign-in" search={{ redirect: search.redirect }}>
          {t('auth.signIn', 'Sign in')}
        </Link>
      </p>
    </AuthFrame>
  )
}
