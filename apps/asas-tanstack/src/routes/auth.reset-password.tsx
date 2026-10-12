import { useState, type ComponentProps } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { documentHead } from '../copy.ts'
import { AlreadySignedIn, AuthBox, AuthFrame, authGate, redirectSearch, useRefusal } from '../auth-frame.tsx'
import { useCopy } from './__root.tsx'

export const Route = createFileRoute('/auth/reset-password')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.resetPassword')),
  validateSearch: (search: Record<string, unknown>): { redirect?: string; token?: string } => ({
    ...redirectSearch(search),
    ...(typeof search.token === 'string' && search.token ? { token: search.token } : {}),
  }),
  beforeLoad: () => authGate(),
  component: ResetPassword,
})

function ResetPassword() {
  const { t } = useCopy()
  const { token, redirect } = Route.useSearch()
  const { password: bounds, signedIn, home } = Route.useRouteContext()
  const refused = useRefusal()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
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
      <Link className="text-primary underline underline-offset-4" to="/auth/sign-in">
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
    setPending(false)
    if (!answered.ok) return setRefusal(refused(answered, t('auth.resetFailed', 'That reset did not work.')))
    setDone(true)
  }

  if (signedIn) return <AlreadySignedIn redirect={redirect} home={home} />
  if (!token) {
    return (
      <AuthFrame title={t('auth.resetPassword', 'Reset password')} description={t('auth.tokenInvalid', 'Token is either invalid or has expired.')}>
        <p className="text-center text-sm">
          <Link className="text-primary underline underline-offset-4" to="/auth/forgot-password">
            {t('auth.forgotPassword', 'Forgot password')}
          </Link>
        </p>
      </AuthFrame>
    )
  }
  if (done) {
    return (
      <AuthFrame title={t('auth.resetPassword', 'Reset password')} description={t('auth.passwordReset', 'Password reset successfully.')}>
        {signIn}
      </AuthFrame>
    )
  }
  return (
    <AuthFrame title={t('auth.resetPassword', 'Reset password')}>
      <form className="grid gap-4" noValidate onSubmit={submit}>
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
            {refusal}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {t('auth.resetPassword', 'Reset password')}
        </Button>
      </form>
      {signIn}
    </AuthFrame>
  )
}
