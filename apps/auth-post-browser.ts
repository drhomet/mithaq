// Run the release consumer with AUTH_BROWSER_EXECUTABLE naming Chromium to exercise the shipped, built auth pages.
import assert from 'node:assert/strict'
import { chromium, type Browser, type Route } from 'playwright-core'

const dummyPassword = 'dummy-password-do-not-use'

/** The browser sees real server-rendered pages; every native Document submit is stopped before the server. */
export const authPostBrowser = async () => {
  const executablePath = process.env.AUTH_BROWSER_EXECUTABLE
  if (!executablePath) {
    assert.ok(process.env.CI === undefined, 'CI requires AUTH_BROWSER_EXECUTABLE and an installed Chromium for native auth checks')
    return undefined
  }
  const browser = await chromium.launch({ executablePath, headless: true })
  return {
    close: () => browser.close(),
    native: (args: { url: string; control?: boolean }) => nativeChecks({ browser, ...args }),
    signIn: (args: { origin: string; email: string; password: string }) => hydratedSignIn({ browser, ...args }),
  }
}

const leaks = ({ urls, fields }: { urls: string[]; fields: Record<string, string> }) => urls.some((url) => {
  const query = new URL(url).searchParams
  return Object.entries(fields).some(([key, value]) => query.has(key) || (value && decodeURIComponent(url).includes(value)))
})

async function nativeChecks({ browser, url, control = false }: { browser: Browser; url: string; control?: boolean }) {
  for (const mode of ['no-JavaScript', 'pre-hydration']) {
    const context = await browser.newContext({ javaScriptEnabled: mode !== 'no-JavaScript', viewport: { width: 390, height: 844 } })
    try {
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      const delayed: Route[] = []
      let armed = false
      let intercepted = 0
      let answer: (request: { method: string; url: string; body: string | null }) => void = () => {}
      const submitted = new Promise<{ method: string; url: string; body: string | null }>((resolve) => { answer = resolve })
      await context.route('**/*', async (route) => {
        const request = route.request()
        if (armed && request.isNavigationRequest() && request.resourceType() === 'document') {
          intercepted++
          answer({ method: request.method(), url: request.url(), body: request.postData() })
          await route.abort('aborted')
        } else if (mode === 'pre-hydration' && request.resourceType() === 'script') {
          // Hold every external script until after the native submission, so React cannot intercept it.
          delayed.push(route)
        } else await route.continue()
      })
      await page.goto(url, { waitUntil: 'commit' })
      await page.locator('form').waitFor({ state: 'attached' })
      for (const input of await page.locator('form input[name]').all()) {
        if (await input.getAttribute('readonly') !== null) continue
        const name = await input.getAttribute('name')
        await input.fill(name === 'email' ? 'dummy-auth-post@example.com' : name === 'name' ? 'Dummy auth post' : dummyPassword)
      }
      if (control) await page.locator('form').evaluate((form) => form.removeAttribute('method'))
      const fields = await page.locator('form').evaluate((form) => Object.fromEntries(new FormData(form as HTMLFormElement))) as Record<string, string>
      const path = new URL(url).pathname
      const expected = path === '/auth/forgot-password' ? ['email']
        : path === '/auth/sign-in' ? ['email', 'password']
        : path === '/auth/sign-up' ? ['name', 'email', 'password', 'confirmation']
        : path === '/auth/first-run' || path === '/auth/create-first-user' ? ['name', 'email', 'password', 'confirmation', 'code']
        : ['email', 'password', 'confirmation']
      assert.deepEqual(Object.keys(fields).sort(), expected.sort(), 'the fixture must render every credential field, including the setup-code branch')
      const initial = page.url()
      armed = true
      const sent = page.waitForEvent('requestfailed', { predicate: (request) => request.isNavigationRequest(), timeout: 10_000 })
      await page.locator('form button[type=submit]').click({ noWaitAfter: true })
      await sent
      const request = await submitted
      const history = await cdp.send('Page.getNavigationHistory')
      const urls = [request.url, page.url(), ...history.entries.map((entry) => entry.url)]
      assert.equal(intercepted, 1, 'the native Document request was intercepted before any server write')
      assert.equal(request.method, control ? 'GET' : 'POST', `${mode} ${new URL(url).pathname}`)
      assert.equal(leaks({ urls, fields }), control, 'the same URL/history assertion must catch the positive GET control')
      if (control) {
        assert.deepEqual(Object.fromEntries(new URL(request.url).searchParams), fields, 'the GET control must expose every form value, including the password on sign-in')
      } else {
        assert.equal(request.url, initial, 'native POST introduces no query parameters')
        assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body!)), fields, 'every successful control, including confirmation and setup code, is in the body')
        if (new URL(url).pathname !== '/auth/forgot-password') assert.ok(fields.password, 'this fixture reaches the password branch')
      }
      if (mode === 'pre-hydration') assert.ok(delayed.length > 0, 'client scripts really were held before submission')
      console.log(`auth native passed: ${mode} ${new URL(url).pathname}${control ? ' GET control' : ''}, ${Object.keys(fields).join(',')}`)
    } finally {
      await context.close()
    }
  }
}

async function hydratedSignIn({ browser, origin, email, password }: { browser: Browser; origin: string; email: string; password: string }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    const documents: string[] = []
    page.on('request', (request) => { if (request.isNavigationRequest()) documents.push(request.url()) })
    await page.goto(`${origin}/auth/sign-in`)
    await page.waitForFunction(() => [...document.querySelectorAll('form')].some((form) => Object.keys(form).some((key) => key.startsWith('__reactFiber'))))
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(password)
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/user/sign-in/email')
    await page.locator('form button[type=submit]').click()
    assert.equal((await response).status(), 200)
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'))
    const session = await (await context.request.get(`${origin}/api/auth/user/get-session`)).json()
    assert.equal(session.user.email, email, 'the hydrated sign-in establishes the real provider session')
    assert.equal(leaks({ urls: [...documents, page.url()], fields: { email, password } }), false)
    console.log(`auth hydrated sign-in passed: ${new URL(page.url()).pathname}`)
  } finally {
    await context.close()
  }
}
