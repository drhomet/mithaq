import assert from 'node:assert/strict'
import { test } from 'node:test'
import { landing } from './redirect.ts'

test('signing in lands where it was asked inside a screen the person opens, else on the one screen they open, else on the chooser', () => {
  const portal = ['/portal']
  const both = ['/dashboard', '/portal']
  assert.equal(landing({ asked: undefined, screens: portal }), '/portal', 'a student, who opens the portal alone, lands on it')
  assert.equal(landing({ asked: '/dashboard', screens: portal }), '/portal', 'and is not sent to the dashboard it would be refused')
  assert.equal(landing({ asked: '/dashboard/courses?page=2', screens: portal }), '/portal', 'nor to a page of it')
  assert.equal(landing({ asked: '/', screens: portal }), '/portal', 'nor back to the landing page')
  assert.equal(landing({ asked: '/portalx', screens: portal }), '/portal', 'nor to a path that only begins with its name')
  assert.equal(landing({ asked: '/portal/courses?page=2', screens: portal }), '/portal/courses?page=2', 'while a page of the portal is honoured, with its search')
  assert.equal(landing({ asked: '//elsewhere.example/portal', screens: portal }), '/portal', 'and another origin never is')
  assert.equal(landing({ asked: undefined, screens: both }), '/unauthorized', 'someone who opens several screens is asked which')
  assert.equal(landing({ asked: '/dashboard/courses', screens: both }), '/dashboard/courses', 'unless they asked for one of them')
  assert.equal(landing({ asked: '/portal', screens: [] }), '/unauthorized', 'and someone who opens none is told why')
})
