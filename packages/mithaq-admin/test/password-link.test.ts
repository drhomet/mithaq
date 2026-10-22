import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { ScreenContext } from 'mithaq/admin/react'
import './tsx.ts'
import { click, mount } from './dom.ts'
const { createRoot } = await import('react-dom/client')
const { PasswordLink } = await import('../registry/password-link.tsx')

test('the issue panel shows expiry, copies and shares to WhatsApp, and cancellation removes the bearer', async () => {
  let cancelled = 0
  const host = mount()
  const root = createRoot(host)
  await act(async () => root.render(createElement(ScreenContext.Provider, { value: { locale: 'en', t: (_key: string, fallback?: string) => fallback } as never }, createElement(PasswordLink, { link: 'https://app.example/auth/set-password?token=dummy', expiresAt: '2030-01-01T12:00:00Z', phone: '+966 50 000 0000', cancel: async () => { cancelled++ } }))))
  assert.match(host.textContent ?? '', /Expires/)
  const share = host.querySelector('a')!
  assert.equal(new URL(share.href).pathname, '/966500000000')
  assert.match(new URL(share.href).searchParams.get('text')!, /Choose your password/)
  const cancel = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Cancel link')!
  await act(async () => click(cancel))
  assert.equal(cancelled, 1)
  assert.equal(host.querySelector('input'), null)
  assert.equal(host.querySelector('a'), null)
  assert.match(host.textContent ?? '', /Link cancelled/)
  await act(async () => root.unmount())
})
