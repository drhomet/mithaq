import { useState, type ComponentProps } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { authArm } from './api.ts'
import { AlreadySignedIn, AuthBox, AuthForm, AuthFrame, authGate, redirectSearch, useRefusal } from './auth-frame.tsx'
import { useCopy } from './routes/__root.tsx'

/** The search keys of a page a mailed link opens: its token, and where to go after. */
export const tokenSearch = (search: Record<string, unknown>): { redirect?: string; token?: string } => ({
  ...redirectSearch(search),
  ...(typeof search.token === 'string' && search.token ? { token: search.token } : {}),
})

/**
 * The address of the account a live link chooses the password of, or `null` for a spent, expired or made-up one: the
 * provider's own answer, read in process. A POST, so the token rides in no further URL.
 */
const passwordLink = createServerFn({ method: 'POST' })
  .validator((token: unknown) => (typeof token === 'string' ? token : ''))
  .handler(async ({ data }) => {
    // Imported inside the server half so no page ships the provider to the browser.
    const { asas } = await import('asas')
    type Provider = { name: string; server: { api: { setPasswordState(args: { query: { token: string } }): Promise<{ email: string }> } } }
    const provider = (asas.auth.strategies as unknown as Provider[]).find((one) => one.name === 'user')!
    return data ? provider.server.api.setPasswordState({ query: { token: data } }).then(({ email }) => email, () => null) : null
  })

/** The `beforeLoad` of a page a mailed link opens: the auth gate's answer, and the account the link is for. */
export const passwordGate = async ({ token }: { token?: string }) => ({ ...(await authGate()), email: token ? await passwordLink({ data: token }) : null })

type Props = {
  /** A first password, chosen from a sign-up's or an added person's link, rather than a forgotten one replaced. */
  first: boolean
  token?: string
  redirect?: string
  signedIn: boolean
  home: { path: string; name?: string }
  /** The screens a signed-in person opens. */
  screens: readonly { name: string; path: string }[]
  password: { min: number; max: number }
  /** The account the link is for; `null` for a link that names none, `undefined` while unread. */
  email?: string | null
}

/**
 * The page a mailed link opens to choose an account's password: a first one, or one forgotten. It shows the account
 * it is for and signs the person in with the password just chosen, through the ordinary sign-in, as Payload's reset
 * does: every rule a sign-in keeps still holds, and nothing is known that the person did not just type.
 */
export function ChoosePassword({ first, token, redirect, signedIn, home, screens, password: bounds, email }: Props) {
  const { t } = useCopy()
  const navigate = useNavigate()
  const refused = useRefusal()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  // The answer, not its sentence, so a language switch says it again in the language chosen.
  const [refusal, setRefusal] = useState<Parameters<typeof refused>[0] | null>(null)
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
  const title = first ? t('auth.setPassword', 'Choose your password') : t('auth.resetPassword', 'Reset password')
  const wrong = {
    password: () =>
      !password ? t('auth.required', 'This field is required.')
      : password.length < bounds.min ? t('auth.passwordTooShort', 'Password too short')
      : password.length > bounds.max ? t('auth.passwordTooLong', 'Password too long')
      : undefined,
    confirmation: () => (!confirmation ? t('auth.required', 'This field is required.') : confirmation === password ? undefined : t('auth.passwordsDiffer', 'The two passwords are not the same.')),
  }
  const errorOf = (box: keyof typeof wrong) => (left.has(box) ? wrong[box]() : undefined)
  const box = (id: keyof typeof wrong, label: string | undefined, props: ComponentProps<'input'> & { description?: string }) => (
    <AuthBox id={id} label={label} error={errorOf(id)} onLeave={() => setLeft((already) => new Set(already).add(id))} {...props} />
  )
  const signIn = (
    <p className="mt-4 text-center text-sm">
      <Link className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 sm:inline sm:min-h-0 sm:min-w-0" to="/auth/sign-in">
        {t('auth.signIn', 'Sign in')}
      </Link>
    </p>
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLeft(new Set(Object.keys(wrong)))
    if (Object.values(wrong).some((check) => check())) return
    setPending(true)
    setRefusal(null)
    const answered = await authArm('reset-password', { newPassword: password, token })
    if (!answered.ok) {
      setPending(false)
      return setRefusal(answered)
    }
    // A sign-in this refuses, a banned account's, is left to the sign-in page, which says why.
    // Signed in, the sign-in page's own gate sends the person on to `redirect` or their first screen.
    if (email && (await authArm('sign-in/email', { email, password })).ok) return navigate({ to: '/auth/sign-in', search: { redirect } })
    setPending(false)
    setDone(true)
  }

  if (signedIn) return <AlreadySignedIn redirect={redirect} home={home} screens={screens} />
  if (!token || email === null) {
    return (
      <AuthFrame title={title} description={t('auth.tokenInvalid', 'Token is either invalid or has expired.')}>
        <p className="text-center text-sm">
          <Link className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 sm:inline sm:min-h-0 sm:min-w-0" to="/auth/forgot-password">
            {t('auth.forgotPassword', 'Forgot password')}
          </Link>
        </p>
      </AuthFrame>
    )
  }
  if (done) {
    return (
      <AuthFrame title={title} description={first ? t('auth.passwordChosen', 'Your address is confirmed and your password is set. Sign in with it.') : t('auth.passwordReset', 'Password reset successfully.')}>
        {signIn}
      </AuthFrame>
    )
  }
  return (
    <AuthFrame title={title}>
      <AuthForm className="grid gap-4" noValidate onSubmit={submit}>
        {/* The account the password is for, which a password manager saves it under. */}
        {email ? <AuthBox id="email" label={t('auth.email', 'Email')} type="email" autoComplete="username" readOnly value={email} onLeave={() => {}} /> : null}
        {box('password', t('auth.newPassword', 'New password'), {
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
            {refused(refusal, t('auth.resetFailed', 'That reset did not work.'))}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {first ? t('auth.setPasswordSubmit', 'Confirm and set password') : t('auth.resetPassword', 'Reset password')}
        </Button>
      </AuthForm>
      {signIn}
    </AuthFrame>
  )
}
