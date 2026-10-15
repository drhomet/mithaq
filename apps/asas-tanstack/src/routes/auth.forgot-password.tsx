import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { documentHead } from '../copy.ts'
import { AlreadySignedIn, AuthBox, AuthFrame, authGate, notAnEmail, redirectSearch, useRefusal } from '../auth-frame.tsx'
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
      <Link className="text-primary underline underline-offset-4" to="/auth/sign-in" search={{ redirect: search.redirect }}>
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
        {import.meta.env?.DEV ? (
          <p data-no-mailer="" className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
            {t('auth.noMailer', 'No mailer is configured, so no email was sent. In development the reset link is written to the server log.')}
          </p>
        ) : null}
        {back}
      </AuthFrame>
    )
  }
  return (
    <AuthFrame
      title={t('auth.forgotPassword', 'Forgot password')}
      description={t('auth.forgotPasswordInstructions', 'Please enter your email below. You will receive an email message with instructions on how to reset your password.')}
    >
      <form className="grid gap-4" noValidate onSubmit={submit}>
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
      </form>
      {back}
    </AuthFrame>
  )
}
