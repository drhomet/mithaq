import { passwordDelivery } from 'asas/organizations'
import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { documentHead } from '../copy.ts'
import { AlreadySignedIn, AuthBox, AuthForm, AuthFrame, authGate, notAnEmail, redirectSearch, useRefusal } from '../auth-frame.tsx'
import { useCopy } from './__root.tsx'

// The sentence after a request is the same whether or not the address has an account, so
// nothing on this page says which it was.

export const Route = createFileRoute('/auth/forgot-password')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.forgotPassword')),
  validateSearch: redirectSearch,
  beforeLoad: () => authGate(),
  component: ForgotPassword,
})

function ForgotPassword() {
  return passwordDelivery === 'admin' ? <AdminForgotPassword /> : <EmailForgotPassword />
}

export function AdminForgotPassword() {
  const { t } = useCopy()
  const search = Route.useSearch()
  const { signedIn, home, screens } = Route.useRouteContext()
  if (signedIn) return <AlreadySignedIn redirect={search.redirect} home={home} screens={screens} />
  return <AuthFrame title={t('auth.forgotPassword', 'Forgot password')} description={t('auth.askAdministrator', 'Ask your administrator for a password link.')}><p className="text-center"><Link className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 sm:inline sm:min-h-0 sm:min-w-0" to="/auth/sign-in" search={{ redirect: search.redirect }}>{t('auth.backToSignIn', 'Back to login')}</Link></p></AuthFrame>
}

export function EmailForgotPassword() {
  const { t } = useCopy()
  const search = Route.useSearch()
  const { signedIn, home, screens } = Route.useRouteContext()
  const refused = useRefusal()
  const [email, setEmail] = useState('')
  const [left, setLeft] = useState(false)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const wrong = () => (!email ? t('auth.required', 'This field is required.') : notAnEmail(email) ? t('auth.invalidEmail', 'Invalid email') : undefined)
  const back = (
    <p className="mt-4 text-center text-sm">
      <Link className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 sm:inline sm:min-h-0 sm:min-w-0" to="/auth/sign-in" search={{ redirect: search.redirect }}>
        {t('auth.backToSignIn', 'Back to login')}
      </Link>
    </p>
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLeft(true)
    if (wrong()) return
    setPending(true)
    setRefusal(null)
    const answered = await authArm('request-password-reset', { email })
    setPending(false)
    if (!answered.ok) return setRefusal(refused(answered, t('auth.requestFailed', 'That request did not work.')))
    setSent(true)
  }

  if (signedIn) return <AlreadySignedIn redirect={search.redirect} home={home} screens={screens} />
  if (sent) {
    return (
      <AuthFrame
        title={t('auth.emailSent', 'Email sent')}
        description={t('auth.checkYourEmail', "If the email address is associated with an account, you will receive instructions to reset your password shortly. Please check your spam or junk mail folder if you don't see the email in your inbox.")}
      >
        {back}
      </AuthFrame>
    )
  }
  return (
    <AuthFrame
      title={t('auth.forgotPassword', 'Forgot password')}
      description={t('auth.forgotPasswordInstructions', 'Please enter your email below. You will receive an email message with instructions on how to reset your password.')}
    >
      <AuthForm className="grid gap-4" noValidate onSubmit={submit}>
        <AuthBox
          autoComplete="email"
          error={left ? wrong() : undefined}
          id="email"
          label={t('auth.email', 'Email')}
          onChange={(event) => setEmail(event.target.value)}
          onLeave={() => setLeft(true)}
          type="email"
          value={email}
        />
        {refusal && (
          <p className="text-destructive text-sm" role="alert">
            {refusal}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {t('auth.submit', 'Submit')}
        </Button>
      </AuthForm>
      {back}
    </AuthFrame>
  )
}
