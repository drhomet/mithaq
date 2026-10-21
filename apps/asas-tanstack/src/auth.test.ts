// The DOM and the JSX loader are imported for their side effect before a page is reached.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { act, createElement } from 'react'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { click, fire, mount, type as typeInto, window } from '../../../packages/mithaq-admin/test/dom.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    // The root route imports its stylesheet as a URL, which only Vite resolves.
    specifier.endsWith('?url')
      ? { shortCircuit: true, url: 'data:text/javascript,export default ""' }
      : next(specifier, specifier === '@tanstack/router-core/isServer' ? { ...context, conditions: ['browser', ...context.conditions] } : context),
})
const { createRoot } = await import('react-dom/client')
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } = await import('@tanstack/react-router')
const signUp = (await import('./routes/auth.sign-up.tsx')).Route.options.component!
const signIn = (await import('./routes/auth.sign-in.tsx')).Route.options.component!
const forgot = (await import('./routes/auth.forgot-password.tsx')).Route.options.component!
const reset = (await import('./routes/auth.reset-password.tsx')).Route.options.component!
const setPassword = (await import('./routes/auth.set-password.tsx')).Route.options.component!
const accept = (await import('./routes/auth.accept-invitation.tsx')).Route.options.component!
const backofficeSignIn = (await import('../../asas-backoffice/src/routes/auth.sign-in.tsx')).Route.options.component!
const { signedInAs } = await import('./auth-frame.tsx')
const { scopes } = await import('./copy.ts')

test('choosing a password keeps native submissions out of the URL before hydration', async () => {
  const { host, unmount } = await start('/auth/set-password?token=dummy-token', setPassword, { context: { email: 'dummy@example.com' } })
  try {
    assert.equal(host.querySelector('form')?.method, 'post')
  } finally {
    await unmount()
  }
})

const start = async (path: string, component: typeof signUp, { locale = 'en', signedIn = false, home = { path: '/dashboard', name: 'dashboard' } as { path: string; name?: string }, context = {} as Record<string, unknown> } = {}) => {
  const root = createRootRoute({ beforeLoad: () => ({ dir: locale === 'ar' ? 'rtl' : 'ltr', locale, app: 'marketing.brand' }), component: () => createElement(Outlet) })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: path.split('?')[0]!, beforeLoad: () => ({ signedIn, home, screens: home.name ? [{ name: home.name, path: home.path }] : [], password: { min: 8, max: 128 }, ...context }), component })]),
  })
  const host = mount()
  const mounted = createRoot(host)
  await act(async () => {
    await router.load()
    mounted.render(createElement(RouterProvider, { router }))
  })
  return { host, unmount: () => act(async () => mounted.unmount()) }
}

test('the page that chooses a password says a short password is short once the box is left, and not before', async () => {
  const { host, unmount } = await start('/auth/set-password?token=t', setPassword, { context: { email: 'someone@example.com' } })
  const errorOf = (name: string) => host.querySelector(`#${name}-error`)?.textContent
  assert.equal(errorOf('password'), undefined, 'a box nobody has been in says nothing')

  await act(async () => typeInto(host.querySelector('#password')!, 'abcde'))
  assert.equal(errorOf('password'), undefined, 'nor does a box still being typed into')
  await act(async () => fire(host.querySelector('#password')!, 'focusout'))
  assert.equal(errorOf('password'), 'Password too short', 'five characters, left, say the provider\'s sentence under the box')
  assert.equal(errorOf('confirmation'), undefined, 'and a box nobody entered still says nothing')

  await act(async () => typeInto(host.querySelector('#password')!, 'abcdefgh'))
  assert.equal(errorOf('password'), undefined, 'eight characters clear it at once')

  await act(async () => typeInto(host.querySelector('#confirmation')!, 'abcdefgx'))
  await act(async () => fire(host.querySelector('#confirmation')!, 'focusout'))
  assert.equal(errorOf('confirmation'), 'The two passwords are not the same.', 'a confirmation that differs says so once left')
  await unmount()
})

test('the sign-up page checks every box on submit, and sends nothing while one is wrong', async () => {
  const { host, unmount } = await start('/auth/sign-up', signUp)
  const sent: string[] = []
  const fetched = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    sent.push(String(url))
    return new Response('{}')
  }) as typeof fetch
  try {
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    assert.deepEqual(sent, [], 'an empty form sends nothing')
    assert.equal(host.querySelector('#name-error')?.textContent, 'This field is required.', 'and every box says why, left or not')
    assert.equal(host.querySelector('#email-error')?.textContent, 'This field is required.', 'the email among them')
    assert.equal(host.querySelector('#password'), null, 'and no password is asked: it is chosen from the mailed link')
  } finally {
    globalThis.fetch = fetched
    await unmount()
  }
})

test('the sign-in page says an email box left empty is required, once left', async () => {
  const { host, unmount } = await start('/auth/sign-in', signIn)
  const errorOf = (name: string) => host.querySelector(`#${name}-error`)?.textContent
  assert.equal(errorOf('email'), undefined, 'a box nobody has been in says nothing')
  await act(async () => fire(host.querySelector('#email')!, 'focusout'))
  assert.equal(errorOf('email'), 'This field is required.', 'left empty, it says so under the box')
  assert.equal(errorOf('password'), undefined, 'and the password box nobody entered says nothing')
  await act(async () => typeInto(host.querySelector('#email')!, 'someone@example.com'))
  assert.equal(errorOf('email'), undefined, 'an address clears it at once')
  await unmount()
})

test('a password box shows its text while its toggle is pressed and hides it again, and the toggle says which', async () => {
  const { host, unmount } = await start('/auth/sign-in', signIn)
  const toggle = () => host.querySelector('button[aria-label="Show password"]')
  assert.equal(host.querySelector('#password')?.getAttribute('type'), 'password', 'the password starts hidden')
  assert.equal(toggle()?.getAttribute('aria-pressed'), 'false', 'under a toggle that is not pressed')
  await act(async () => click(toggle()!))
  assert.equal(host.querySelector('#password')?.getAttribute('type'), 'text', 'pressed, it shows what was typed')
  assert.equal(toggle()?.getAttribute('aria-pressed'), 'true', 'and the toggle says it is pressed')
  await act(async () => click(toggle()!))
  assert.equal(host.querySelector('#password')?.getAttribute('type'), 'password', 'pressed again, it hides it')
  await unmount()
})

test('pressing a password box\'s toggle does not leave the box, so an empty password says nothing until focus goes elsewhere', async () => {
  const { host, unmount } = await start('/auth/sign-in', signIn)
  const box = host.querySelector('#password')!
  const toggle = host.querySelector('button[aria-label="Show password"]')!
  const leave = (to: Element | null) => box.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: to as never }) as unknown as Event)
  await act(async () => leave(toggle))
  assert.equal(host.querySelector('#password-error')?.textContent, undefined, 'focus moving to the toggle says nothing')
  await act(async () => leave(null))
  assert.equal(host.querySelector('#password-error')?.textContent, 'This field is required.', 'focus leaving the box says it is required')
  await unmount()
})

const refusedWith = async (path: string, component: typeof signUp, locale: string, status: number, body: unknown, fill: (host: HTMLElement) => void) => {
  const { host, unmount } = await start(path, component, { locale })
  const fetched = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  try {
    await act(async () => fill(host))
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    return host.querySelector('[role="alert"]')?.textContent
  } finally {
    globalThis.fetch = fetched
    await unmount()
  }
}
const asked = (host: HTMLElement) => typeInto(host.querySelector('#email')!, 'someone@example.com')
const newPassword = (host: HTMLElement) => {
  typeInto(host.querySelector('#password')!, 'a-long-enough-password')
  typeInto(host.querySelector('#confirmation')!, 'a-long-enough-password')
}

test('the forgot and reset pages say a refusal the provider gives a code or a status for in this app\'s own words, in either locale', async () => {
  // Better Auth's rate limit answers 429 with no code.
  const copy = scopes.auth!
  for (const locale of ['en', 'ar']) {
    assert.equal(await refusedWith('/auth/forgot-password', forgot, locale, 400, { code: 'RESET_PASSWORD_DISABLED', message: "Reset password isn't enabled" }, asked), copy.resetDisabled![locale], `the forgot page says reset is not available in ${locale}`)
    assert.equal(await refusedWith('/auth/forgot-password', forgot, locale, 429, { message: 'Too many requests. Please try again later.' }, asked), copy.tooManyRequests![locale], `and too many requests in ${locale}`)
    assert.equal(await refusedWith('/auth/reset-password?token=t', reset, locale, 400, { code: 'INVALID_TOKEN', message: 'Invalid token' }, newPassword), copy.tokenInvalid![locale], `the reset page says the token is no good in ${locale}`)
    assert.equal(await refusedWith('/auth/reset-password?token=t', reset, locale, 429, { message: 'Too many requests. Please try again later.' }, newPassword), copy.tooManyRequests![locale], `and too many requests in ${locale}`)
  }
})

test('switching the language on the sign-in page keeps what was typed and the refusal shown, and redraws the page in the language chosen with no reload', async (t) => {
  const reload = t.mock.method(window.location, 'reload', () => {})
  window.document.documentElement.lang = 'en'
  // The root reads the locale off the document on the client, as the app's own does.
  const root = createRootRoute({ beforeLoad: () => { const locale = window.document.documentElement.lang; return { dir: locale === 'ar' ? 'rtl' : 'ltr', locale, app: 'marketing.brand' } }, component: () => createElement(Outlet) })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/auth/sign-in'] }),
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/auth/sign-in', beforeLoad: () => ({ password: { min: 8, max: 128 } }), component: signIn })]),
  })
  const host = mount()
  const mounted = createRoot(host)
  await act(async () => {
    await router.load()
    mounted.render(createElement(RouterProvider, { router }))
  })
  const fetched = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD' }), { status: 401 })) as typeof fetch
  try {
    await act(async () => {
      typeInto(host.querySelector('#email')!, 'someone@example.com')
      typeInto(host.querySelector('#password')!, 'a-password-typed')
    })
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    await act(async () => click([...host.querySelectorAll('header button')].find((one) => one.getAttribute('aria-label') === 'العربية')!))
    assert.equal(reload.mock.callCount(), 0, 'the page is not reloaded')
    assert.match(window.document.cookie, /locale=ar/, 'the choice is kept for the next request')
    assert.equal(host.querySelector('h1')?.textContent, scopes.auth!.signIn!.ar, 'the page reads in Arabic')
    assert.equal((host.querySelector('#email') as HTMLInputElement).value, 'someone@example.com', 'the email typed is kept')
    assert.equal((host.querySelector('#password') as HTMLInputElement).value, 'a-password-typed', 'and the password')
    assert.equal(host.querySelector('[role="alert"]')?.textContent, scopes.auth!.invalidCredentials!.ar, 'and the refusal, said again in Arabic')
  } finally {
    globalThis.fetch = fetched
    await act(async () => mounted.unmount())
    window.document.cookie = 'locale=en; Path=/'
    window.document.documentElement.lang = 'en'
  }
})

test('the tenant sign-in page names no one screen, since a portal user signs in on it as a dashboard user does, in either locale', async () => {
  for (const locale of ['en', 'ar']) {
    const { host, unmount } = await start('/auth/sign-in', signIn, { locale })
    const said = host.querySelector('[data-slot=card-description]')?.textContent ?? ''
    assert.ok(said, `the page says what it is for in ${locale}`)
    assert.doesNotMatch(said, /dashboard|portal|لوحة|البوابة/i, `in ${locale}, it names no screen: ${said}`)
    await unmount()
  }
})

test('the sign-in page says a refusal in this app\'s own words for the provider\'s code, never the provider\'s English, in either locale', async () => {
  const copy = scopes.auth!
  const filled = (host: HTMLElement) => {
    typeInto(host.querySelector('#email')!, 'someone@example.com')
    typeInto(host.querySelector('#password')!, 'wrong-password')
  }
  for (const locale of ['en', 'ar']) {
    assert.equal(await refusedWith('/auth/sign-in', signIn, locale, 401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, filled), copy.invalidCredentials![locale], `a wrong password in ${locale}`)
    assert.equal(await refusedWith('/auth/sign-in', signIn, locale, 403, { code: 'BANNED_USER', message: 'You have been banned from this application' }, filled), copy.banned![locale], `a banned account in ${locale}`)
    assert.equal(await refusedWith('/auth/sign-in', signIn, locale, 400, { code: 'SOMETHING_ELSE', message: 'Some English' }, filled), copy.failed![locale], `a code this app has no words for reads as its own fallback in ${locale}`)
  }
  assert.notEqual(copy.invalidCredentials!.ar, copy.invalidCredentials!.en, 'and the Arabic is not the English')
  assert.equal(await refusedWith('/auth/sign-in', backofficeSignIn, 'ar', 401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, filled), copy.invalidCredentials!.ar, 'the backoffice\'s sign-in in Arabic')
  assert.equal(await refusedWith('/auth/sign-in', backofficeSignIn, 'ar', 400, { code: 'SOMETHING_ELSE', message: 'Some English' }, filled), copy.failed!.ar, 'and its fallback is its own')
})

test('the sign-up page says a refusal in this app\'s own words, and the page that chooses a password flags an empty confirmation as required on submit', async () => {
  const copy = scopes.auth!
  const filled = (host: HTMLElement) => {
    for (const [id, value] of [['name', 'Someone'], ['email', 'someone@example.com']]) typeInto(host.querySelector(`#${id}`)!, value!)
  }
  for (const locale of ['en', 'ar']) {
    assert.equal(await refusedWith('/auth/sign-up', signUp, locale, 403, { code: 'SIGN_UP_DOMAIN', message: 'This address is not at a domain that may sign up here.' }, filled), copy.outsideDomains![locale], `in ${locale}`)
  }
  const { host, unmount } = await start('/auth/set-password?token=t', setPassword, { context: { email: 'someone@example.com' } })
  await act(async () => typeInto(host.querySelector('#password')!, 'a-long-enough-password'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(host.querySelector('#confirmation-error')?.textContent, 'This field is required.', 'an empty confirmation is required, like every other box')
  await unmount()
})

test('a signed-in person on the forgot or reset page is told so, with the way on and a sign-out, in either locale', async () => {
  const portal = { path: '/portal', name: 'portal' }
  const none = { path: '/unauthorized' }
  for (const locale of ['en', 'ar']) {
    const back = (screen: string) => scopes.auth!.backTo![locale]!.replace('{screen}', scopes.screens![screen]![locale]!)
    for (const [path, component] of [['/auth/forgot-password', forgot], ['/auth/reset-password?token=t', reset]] as const) {
      for (const [redirect, landing, said, home] of [
        ['', '/dashboard', back('dashboard'), undefined],
        ['/dashboard/courses', '/dashboard/courses', scopes.auth!.continue![locale], undefined],
        ['https://elsewhere.example', '/dashboard', back('dashboard'), undefined],
        ['', '/portal', back('portal'), portal],
        ['', '/unauthorized', scopes.auth!.accountStatus![locale], none],
      ] as const) {
        const url = redirect ? `${path}${path.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(redirect)}` : path
        const { host, unmount } = await start(url, component, { locale, signedIn: true, ...(home && { home }) })
        const at = `${url} in ${locale}`
        assert.ok(host.textContent?.includes(scopes.auth!.alreadySignedIn![locale]!), `${at} says the person is already signed in`)
        assert.equal(host.querySelector('form'), null, `${at} draws no form`)
        const onward = [...host.querySelectorAll('a')].find((one) => one.textContent === said)
        assert.equal(onward?.getAttribute('href'), landing, `${at} links on to ${landing} as "${said}"`)
        assert.ok([...host.querySelectorAll('button')].some((one) => one.textContent === scopes.admin!.signOut![locale]), `${at} offers a sign-out`)
        await unmount()
      }
    }
  }
})

test('a read of the actor that throws reads as no one, so an auth page still draws its form', async () => {
  assert.equal(await signedInAs(Promise.reject(new Error('the session store is down'))), false, 'a read that throws is no one')
  assert.equal(await signedInAs(Promise.resolve(null)), false, 'nor is no actor')
  assert.equal(await signedInAs(Promise.resolve({ id: 'x' })), false, 'nor an actor with no email')
  assert.equal(await signedInAs(Promise.resolve({ email: 'someone@example.com' })), true, 'an actor with an email is someone')
})

test('sign-up opened from an invitation draws no organization box, says so, and submits without one', async () => {
  const { host, unmount } = await start(`/auth/sign-up?redirect=${encodeURIComponent('/auth/accept-invitation?id=inv-1')}`, signUp)
  const sent: string[] = []
  const fetched = globalThis.fetch
  // The sign-up is never answered, so nothing that follows it runs here.
  globalThis.fetch = ((url: string) => (sent.push(String(url)), new Promise(() => {}))) as unknown as typeof fetch
  try {
    assert.equal(host.querySelector('#organization'), null, 'no organization box')
    assert.equal(host.textContent?.includes(scopes.auth!.signUpInvitedDescription!.en!), true, 'and the page says which address to use')
    await act(async () => {
      for (const [id, value] of [['name', 'Invitee'], ['email', 'invitee@example.com']]) typeInto(host.querySelector(`#${id}`)!, value!)
    })
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    assert.deepEqual(sent, ['/api/auth/user/sign-up/email'], 'the form is sent with no organization named, so none is asked for')
    assert.equal(host.querySelector('[role="alert"]'), null, 'and nothing is refused')
  } finally {
    globalThis.fetch = fetched
    await unmount()
  }
})

test('with many organizations a sign-up asks a name and an address alone, sends the sign-up alone and says to open the mailed link, where the password is chosen', async () => {
  const { host, unmount } = await start('/auth/sign-up?redirect=%2Fdashboard', signUp)
  const sent: string[] = []
  const fetched = globalThis.fetch
  const bodies: unknown[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push(String(url))
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ token: null, user: {} }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    assert.equal(host.querySelector('#organization'), null, 'no organization box: an organization is made once the address is proved')
    assert.deepEqual([...host.querySelectorAll('input')].map((one) => one.id), ['name', 'email'])
    await act(async () => {
      for (const [id, value] of [['name', 'Founder'], ['email', 'founder@example.com']]) typeInto(host.querySelector(`#${id}`)!, value!)
    })
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    assert.deepEqual(sent, ['/api/auth/user/sign-up/email'], 'the sign-up alone, never a second call that could leave an account half made')
    assert.deepEqual(bodies, [{ name: 'Founder', email: 'founder@example.com' }], 'with no password, which nobody types twice')
    assert.equal(host.textContent?.includes(scopes.auth!.verifySent!.en!), true, 'and the page says to open the mailed link')
  } finally {
    globalThis.fetch = fetched
    await unmount()
  }
})

test('a first-time link opens a page that chooses the password of the account it names, shown and not editable, then signs the person in through the ordinary sign-in, in either locale', async () => {
  for (const locale of ['en', 'ar']) {
    const sent: { url: string; body: unknown }[] = []
    const fetched = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) })
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const { host, unmount } = await start('/auth/set-password?token=the-token', setPassword, { locale, context: { email: 'chosen@example.com' } })
    try {
      assert.equal(host.querySelector('h1')?.textContent, scopes.auth!.setPassword![locale], `titled for a first password in ${locale}`)
      assert.equal(scopes.auth!.setPassword!.en, 'Choose your password')
      const account = host.querySelector('#email') as HTMLInputElement
      assert.equal(account.value, 'chosen@example.com', 'the account it chooses for is shown')
      assert.equal(account.readOnly, true, 'and cannot be changed')
      assert.equal(account.getAttribute('autocomplete'), 'username', 'so a password manager saves the password under it')
      assert.equal(host.querySelector('button[type=submit]')?.textContent, scopes.auth!.setPasswordSubmit![locale], `under a button that says what it does in ${locale}`)
      await act(async () => {
        typeInto(host.querySelector('#password')!, 'the-chosen-password')
        typeInto(host.querySelector('#confirmation')!, 'the-chosen-password')
      })
      await act(async () => fire(host.querySelector('form')!, 'submit'))
      await act(async () => new Promise((done) => setTimeout(done, 20)))
      assert.deepEqual(sent.slice(0, 2), [
        { url: '/api/auth/user/reset-password', body: { newPassword: 'the-chosen-password', token: 'the-token' } },
        { url: '/api/auth/user/sign-in/email', body: { email: 'chosen@example.com', password: 'the-chosen-password' } },
      ], 'the password is set, then signed in with through the ordinary sign-in, so every rule of a sign-in still holds')
    } finally {
      globalThis.fetch = fetched
      await unmount()
    }
  }
})

test('a link that names no live account is said at once, with the way to ask for another, in either locale', async () => {
  for (const locale of ['en', 'ar']) {
    const { host, unmount } = await start('/auth/set-password?token=spent', setPassword, { locale, context: { email: null } })
    assert.equal(host.querySelector('form'), null, 'no form to fill for nothing')
    assert.ok(host.textContent?.includes(scopes.auth!.tokenInvalid![locale]!), `it says the link is no good in ${locale}`)
    assert.equal(host.querySelector('a[href="/auth/forgot-password"]')?.textContent, scopes.auth!.forgotPassword![locale], 'and offers to ask for another')
    await unmount()
  }
})

test('the invitation page offers a visitor with no session sign-in and sign-up that come back to it, and none without an id', async () => {
  const { host, unmount } = await start('/auth/accept-invitation?id=inv-1', accept, { locale: 'ar' })
  const hrefs = [...host.querySelectorAll('a')].map((one) => one.getAttribute('href')).filter((href) => href?.startsWith('/auth/'))
  const back = encodeURIComponent('/auth/accept-invitation?id=inv-1')
  assert.deepEqual(hrefs, [`/auth/sign-in?redirect=${back}`, `/auth/sign-up?redirect=${back}`])
  assert.equal(host.textContent?.includes(scopes.auth!.invitationSignedOut!.ar!), true, 'in the page\'s locale')
  await unmount()
  const none = await start('/auth/accept-invitation', accept)
  assert.equal(none.host.textContent?.includes(scopes.auth!.invitationMissing!.en!), true)
  await none.unmount()
})

test('a signed-in person reads the invitation and accepts it with one press, and a spent one or another address\'s is said in this app\'s words in either locale', async () => {
  const copy = scopes.auth!
  const opened = async (locale: string, read: [number, unknown], accepted?: [number, unknown]) => {
    const sent: { url: string; body?: string }[] = []
    const fetched = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url: String(url), ...(typeof init?.body === 'string' ? { body: init.body } : {}) })
      const [status, body] = String(url).includes('get-invitation') ? read : accepted!
      return new Response(JSON.stringify(body), { status })
    }) as typeof fetch
    const { host, unmount } = await start('/auth/accept-invitation?id=inv-1', accept, { locale, signedIn: true })
    try {
      await act(async () => {})
      if (accepted) await act(async () => click(host.querySelector('[data-button="accept-invitation"]')!))
      const home = host.querySelector('[data-home]')
      return { text: host.textContent ?? '', alert: host.querySelector('[role="alert"]')?.textContent, sent, home: home && [home.getAttribute('href'), home.textContent] }
    } finally {
      globalThis.fetch = fetched
      await unmount()
    }
  }
  for (const locale of ['en', 'ar']) {
    const spent = await opened(locale, [400, { message: 'Invitation not found!' }])
    assert.equal(spent.alert, copy.invitationGone![locale], `a spent invitation in ${locale}`)
    assert.deepEqual(spent.home, ['/dashboard', scopes.marketing!.openScreen![locale]!.replace('{screen}', scopes.screens?.dashboard?.[locale] ?? 'dashboard')], `with the way to the person's own first screen, in ${locale}`)
    assert.equal((await opened(locale, [403, { code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', message: 'You are not the recipient of the invitation' }])).alert, copy.invitationNotYours![locale], `another address's in ${locale}`)
    assert.equal((await opened(locale, [400, { code: 'INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION', message: 'Inviter is no longer a member of the organization' }])).alert, copy.invitationInviterGone![locale], `an inviter who left in ${locale}`)
  }
  assert.ok((await opened('ar', [200, { organizationName: 'Tenant one', organizationNames: { en: 'Tenant one', ar: 'المستأجر الأول' } }])).text.includes('المستأجر الأول'), 'the organization is named in the reader\'s language')
  const pressed = await opened('en', [200, { organizationName: 'Tenant one' }], [400, { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found' }])
  assert.equal(pressed.text.includes('You are invited to join Tenant one.'), true, 'the organization is named')
  assert.deepEqual(pressed.sent.map((one) => [one.url, one.body]), [
    ['/api/auth/user/organization/get-invitation?id=inv-1', undefined],
    ['/api/auth/user/organization/accept-invitation', JSON.stringify({ invitationId: 'inv-1' })],
  ], 'and one press posts the accept, which is the only write')
  assert.equal(pressed.alert, copy.invitationGone!.en, 'a refusal of the accept is worded too')
})
