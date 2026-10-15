import { useState, type ComponentProps } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authArm } from '../api.ts'
import { AuthBox, AuthFrame, authGate, notAnEmail, useRefusal } from '../auth-frame.tsx'
import { documentHead } from '../copy.ts'
import { firstRun } from '../first-run.ts'
import { useCopy } from './__root.tsx'

// The first owner of an app of one organization, and the organization itself: open once,
// to the holder of the setup code, and closed for good once the organization exists. The
// organization's name lives in code (`organizationName` in `organizations.ts`), so none is asked.
export const Route = createFileRoute('/auth/first-run')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.firstRun')),
  beforeLoad: async () => {
    const state = await firstRun()
    // `href`, not `to`: sign-in redirects here too, and two routes typed by each other's paths infer nothing.
    if (!state.open) throw redirect({ href: '/auth/sign-in' })
    return { code: state.code, password: (await authGate()).password }
  },
  component: FirstRun,
})

function FirstRun() {
  const navigate = useNavigate()
  const { t } = useCopy()
  const refused = useRefusal()
  const { code: asked, password: bounds } = Route.useRouteContext()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
  const required = t('auth.required', 'This field is required.')
  const wrong = {
    name: () => (name.trim() ? undefined : required),
    email: () => (!email ? required : notAnEmail(email) ? t('auth.invalidEmail', 'Invalid email') : undefined),
    password: () =>
      !password ? required
      : password.length < bounds.min ? t('auth.passwordTooShort', 'Password too short')
      : password.length > bounds.max ? t('auth.passwordTooLong', 'Password too long')
      : undefined,
    confirmation: () => (!confirmation ? required : confirmation === password ? undefined : t('auth.passwordsDiffer', 'The two passwords are not the same.')),
    code: () => (asked !== 'required' || code ? undefined : required),
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
    const made = await authArm('first-run', { name, email, password, ...(asked === 'required' && { code }) })
    setPending(false)
    if (!made.ok) return setRefusal(refused(made, t('auth.firstRunFailed', 'That owner could not be made.')))
    await navigate({ to: '/auth/sign-in' })
  }

  if (asked === 'unset') {
    return (
      <AuthFrame title={t('auth.firstRun', 'Set up this app')}>
        <p className="text-sm" role="alert">
          {t('auth.firstRunCodeUnset')}
        </p>
      </AuthFrame>
    )
  }
  return (
    <AuthFrame title={t('auth.firstRun', 'Set up this app')} description={t('auth.firstRunDescription', 'Nobody owns this app yet. The account made here becomes its owner and first administrator.')}>
      <form className="grid gap-4" noValidate onSubmit={submit}>
        {box('name', t('auth.name', 'Name'), { autoComplete: 'name', onChange: (event) => setName(event.target.value), type: 'text', value: name })}
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
        {asked === 'required'
          ? box('code', t('auth.setupCode', 'Setup code'), {
              autoComplete: 'off',
              description: t('auth.setupCodeDescription', 'The SETUP_CODE this server was started with.'),
              onChange: (event) => setCode(event.target.value),
              type: 'password',
              value: code,
            })
          : null}
        {/* `role="alert"` so a refusal is spoken when it appears; nothing moves the focus to it. */}
        {refusal && (
          <p className="text-destructive text-sm" role="alert">
            {refusal}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {pending ? t('auth.firstRunPending', 'Setting up…') : t('auth.firstRunSubmit', 'Set up the app')}
        </Button>
      </form>
    </AuthFrame>
  )
}
