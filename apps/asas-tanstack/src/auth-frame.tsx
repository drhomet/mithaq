import { useState, type ComponentProps, type ReactNode } from 'react'
import { redirect, useRouteContext } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { authArm } from './api.ts'
import { FieldShell, describedBy } from './components/mithaq/field-shell.tsx'
import { refusalKey } from './copy.ts'
import { LocaleSwitch } from './locale-switch.tsx'
import { wanted } from './redirect.ts'
import { useCopy } from './routes/__root.tsx'

/** The one search key the auth pages read, off the raw search. */
export const redirectSearch = (search: Record<string, unknown>): { redirect?: string } =>
  typeof search.redirect === 'string' ? { redirect: search.redirect } : {}

/** Whether a read of the actor names someone. A read that throws, or an actor with no email, names no one. */
export const signedInAs = async (actor: Promise<unknown>) => Boolean(((await actor.catch(() => null)) as { email?: unknown } | null)?.email)

/**
 * Whether this request carries a session, where signing in lands for it, and the provider's password bounds.
 * No auth page sends a referrer, since the reset page's address carries its token.
 */
export const authGate = createServerFn({ method: 'GET' }).handler(async () => {
  // Imported inside the server half so no auth page ships the screen host to the browser.
  const [{ getRequest, setResponseHeader }, { asas }, { loadEnterable }] = await Promise.all([import('@tanstack/react-start/server'), import('asas'), import('./screens.tsx')])
  setResponseHeader('referrer-policy', 'no-referrer')
  type Provider = { name: string; server: { $context: Promise<{ password: { config: { minPasswordLength: number; maxPasswordLength: number } } }> } }
  const provider = (asas.auth.strategies as unknown as Provider[]).find((one) => one.name === 'user')!
  const [signedIn, { password }] = await Promise.all([signedInAs(asas.auth.actor(getRequest().headers)), provider.server.$context])
  const first = signedIn ? (await loadEnterable())?.screens[0] : undefined
  const home: { path: string; name?: string } = first ?? { path: '/unauthorized' }
  return { signedIn, home, password: { min: password.config.minPasswordLength, max: password.config.maxPasswordLength } }
})

/**
 * Sign-in's and sign-up's `beforeLoad`. A signed-in person is sent where a
 * successful sign-in sends them; everyone else gets the password bounds in the
 * route context.
 */
export const gate = async ({ search }: { search: { redirect?: string } }) => {
  const { signedIn, home, password } = await authGate()
  if (signedIn) throw redirect({ href: wanted({ asked: search.redirect, home: home.path }) })
  return { password }
}

/** What a link to `home` says: the screen it opens, or, where it opens none, the action of seeing the account's status. */
export const useHomeLabel = () => {
  const { t } = useCopy()
  return (home: { name?: string }, sentence: 'auth.backTo' | 'marketing.openScreen') =>
    home.name === undefined
      ? t('auth.accountStatus', 'See your account status')
      : t(sentence, sentence === 'auth.backTo' ? 'Back to {screen}' : 'Open {screen}')!.replace('{screen}', () => t(`screens.${home.name}`, home.name)!)
}

/** What the forgot and reset pages draw for someone already signed in: the way on, and a sign-out. */
export function AlreadySignedIn({ redirect: asked, home }: { redirect?: string; home: { path: string; name?: string } }) {
  const { t } = useCopy()
  const label = useHomeLabel()
  const to = wanted({ asked, home: home.path })
  return (
    <AuthFrame title={t('auth.alreadySignedIn', 'You are already signed in')}>
      <div className="grid gap-4">
        {/* An anchor: the path is the visitor's own, not a route the router knows. */}
        <a className="text-primary text-center text-sm underline underline-offset-4" href={to}>
          {to === home.path ? label(home, 'auth.backTo') : t('auth.continue', 'Continue')}
        </a>
        <Button type="button" variant="outline" onClick={() => void authArm('sign-out').then(() => window.location.reload())}>
          {t('admin.signOut', 'Sign out')}
        </Button>
      </div>
    </AuthFrame>
  )
}

/** The sentence for a refusal of the provider: this app's own words for the status or code, then `fallback`. Never the provider's `message`, which is English in any locale. */
export const useRefusal = () => {
  const { t } = useCopy()
  return (answered: { status: number; body: Record<string, unknown> | null }, fallback: string | undefined) => {
    const key = refusalKey(answered.status, answered.body?.code)
    return (key && t(key)) || fallback || ''
  }
}

/** Whether the browser's own `type="email"` refuses this text. */
export const notAnEmail = (value: string) => Object.assign(document.createElement('input'), { type: 'email', value }).validity.typeMismatch

/** The frame every auth page is drawn in: the app's name linking home, the language switch, and the page's card. */
export function AuthFrame({ title, description, children }: { title: string | undefined; description?: ReactNode; children: ReactNode }) {
  const { t, locale } = useCopy()
  const { app } = useRouteContext({ from: '__root__' })
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        {/* An anchor: `/` is not a router route in an app whose start entry answers its home. */}
        <a className="text-lg font-semibold" href="/">
          {t(app, 'Asas')}
        </a>
        <LocaleSwitch locale={locale} />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle><h1>{title}</h1></CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          {/* Descriptions follow the text direction; the shared primitive aligns them left. */}
          <CardContent className="[&_[data-slot=field-description]]:text-start">{children}</CardContent>
        </Card>
      </main>
    </div>
  )
}

function PasswordInput(props: ComponentProps<'input'>) {
  const { t } = useCopy()
  const [shown, setShown] = useState(false)
  return (
    // Focus moving to the box's own toggle has not left the box.
    <InputGroup onBlur={(event) => event.currentTarget.contains(event.relatedTarget) && event.stopPropagation()}>
      <InputGroupInput {...props} dir="ltr" type={shown ? 'text' : 'password'} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label={t('auth.showPassword', 'Show password')} aria-pressed={shown} size="icon-xs" onClick={() => setShown((was) => !was)}>
          {shown ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

/** One labelled box, which says what is wrong with it once it has been left. An email or password reads left to right in any locale. */
export function AuthBox({
  id,
  label,
  error,
  description,
  onLeave,
  ...props
}: { id: string; label: string | undefined; error?: string; description?: string; onLeave: () => void } & ComponentProps<'input'>) {
  const control = { 'aria-describedby': describedBy({ id, description, error }), 'aria-invalid': error ? true : undefined, id, name: id, required: true, ...props }
  return (
    <FieldShell id={id} label={label ?? id} description={description} error={error} onBlur={onLeave}>
      {props.type === 'password' ? <PasswordInput {...control} /> : <Input dir={props.type === 'email' ? 'ltr' : 'auto'} {...control} />}
    </FieldShell>
  )
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 ab822afe361dfc5f82c504570fd5d0ea13ec4572e60adb679a3f9532ccf67803
