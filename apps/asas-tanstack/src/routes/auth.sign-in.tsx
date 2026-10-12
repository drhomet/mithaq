import { useState, type ComponentProps } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { documentHead } from '../copy.ts'
import { AuthBox, AuthFrame, authGate, gate, notAnEmail, redirectSearch, useRefusal } from '../auth-frame.tsx'
import { useCopy } from './__root.tsx'
import { wanted } from '../redirect.ts'

// The password has no length rule here because the provider's sign-in has none: a wrong
// password of any length is the one refusal it answers.

export const Route = createFileRoute('/auth/sign-in')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.signIn')),
  // The router hands `validateSearch` whatever the URL carried; `wanted` decides what is honoured.
  validateSearch: redirectSearch,
  beforeLoad: gate,
  component: SignIn,
})

function SignIn() {
  const navigate = useNavigate()
  const { t } = useCopy()
  const search = Route.useSearch()
  const refused = useRefusal()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
  const required = t('auth.required', 'This field is required.')
  const wrong = {
    email: () => (!email ? required : notAnEmail(email) ? t('auth.invalidEmail', 'Invalid email') : undefined),
    password: () => (password ? undefined : required),
  }
  const errorOf = (box: keyof typeof wrong) => (left.has(box) ? wrong[box]() : undefined)
  const box = (id: keyof typeof wrong, label: string | undefined, props: ComponentProps<'input'>) => (
    <AuthBox id={id} label={label} error={errorOf(id)} onLeave={() => setLeft((already) => new Set(already).add(id))} {...props} />
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLeft(new Set(Object.keys(wrong)))
    if (Object.values(wrong).some((check) => check())) return
    setPending(true)
    setRefusal(null)
    const answered = await authArm('sign-in/email', { email, password })
    // The project's own sentence for the provider's code, never its English `message`, since copy carries every locale.
    if (!answered.ok) {
      setPending(false)
      return setRefusal(refused(answered, t('auth.failed', 'That sign-in did not work.')))
    }

    setPending(false)

    // The first screen this actor enters is read only once the session exists.
    await navigate({ to: wanted({ asked: search.redirect, home: (await authGate()).home.path }) })
  }

  return (
    <AuthFrame title={t('auth.signIn', 'Sign in')} description={t('auth.signInDescription', 'Sign in to reach the dashboard.')}>
      <form className="grid gap-4" noValidate onSubmit={submit}>
        {box('email', t('auth.email', 'Email'), { autoComplete: 'email', onChange: (event) => setEmail(event.target.value), type: 'email', value: email })}
        {box('password', t('auth.password', 'Password'), { autoComplete: 'current-password', onChange: (event) => setPassword(event.target.value), type: 'password', value: password })}
        <Link className="-mt-2 justify-self-end text-sm text-muted-foreground underline-offset-4 hover:underline" to="/auth/forgot-password" search={{ redirect: search.redirect }}>
          {t('auth.forgotPasswordQuestion', 'Forgot password?')}
        </Link>
        {/* `role="alert"` so a refusal is spoken when it appears: nothing moves the focus to it. */}
        {refusal && (
          <p className="text-destructive text-sm" role="alert">
            {refusal}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {pending ? t('auth.signInPending', 'Signing in…') : t('auth.signIn', 'Sign in')}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t('auth.noAccount', 'No account yet?')}{' '}
        <Link className="text-primary underline underline-offset-4" to="/auth/sign-up" search={{ redirect: search.redirect }}>
          {t('auth.signUp', 'Sign up')}
        </Link>
      </p>
    </AuthFrame>
  )
}
