import { useState, type ComponentProps } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { AuthBox, AuthFrame, authGate, notAnEmail, redirectSearch, useRefusal } from '../auth-frame.tsx'
import { documentHead } from '../copy.ts'
import { firstUser } from '../first-user.ts'
import { useCopy } from './__root.tsx'
import { landing } from '../redirect.ts'

export const Route = createFileRoute('/auth/sign-in')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.signIn')),
  validateSearch: redirectSearch,
  // Nobody can sign in to a backoffice no one administers yet.
  beforeLoad: async () => {
    if (!(await firstUser()).initialized) throw redirect({ href: '/auth/create-first-user' })
  },
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
    // Our own sentence for the provider's code, not its English `message`: a refusal is copy and carries a string per locale.
    if (!answered.ok) {
      setPending(false)
      return setRefusal(refused(answered, t('auth.failed', 'That sign-in did not work.')))
    }

    setPending(false)

    // A navigation, not a reload, so the screen's loader runs with the cookie just set.
    await navigate({ href: landing({ asked: search.redirect, screens: (await authGate()).screens }) })
  }

  return (
    <AuthFrame title={t('auth.signIn', 'Sign in')} description={t('auth.signInBackofficeDescription', 'Sign in to reach the backoffice.')}>
      <form className="grid gap-4" noValidate onSubmit={submit}>
        {box('email', t('auth.email', 'Email'), { autoComplete: 'email', onChange: (event) => setEmail(event.target.value), type: 'email', value: email })}
        {box('password', t('auth.password', 'Password'), { autoComplete: 'current-password', onChange: (event) => setPassword(event.target.value), type: 'password', value: password })}
        {/* `role="alert"` so a refusal is spoken when it appears; nothing moves the focus to it. */}
        {refusal && (
          <p className="text-destructive text-sm" role="alert">
            {refusal}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {pending ? t('auth.signInPending', 'Signing in…') : t('auth.signIn', 'Sign in')}
        </Button>
      </form>
    </AuthFrame>
  )
}
