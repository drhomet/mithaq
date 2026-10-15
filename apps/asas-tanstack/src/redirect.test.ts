import assert from 'node:assert/strict'
import { test } from 'node:test'
import { landing, wanted } from './redirect.ts'

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
  // Dot segments are resolved before the screen is read, so a path naming the portal cannot walk out of it.
  assert.equal(landing({ asked: '/portal/../dashboard', screens: portal }), '/portal', 'a dot segment does not climb out of the portal')
  assert.equal(landing({ asked: '/portal/%2e%2e/dashboard', screens: portal }), '/portal', 'nor an encoded one')
  assert.equal(landing({ asked: '/portal/.%2e/%2e./dashboard', screens: portal }), '/portal', 'nor a half-encoded one')
  assert.equal(landing({ asked: '/portal/..//evil.example', screens: portal }), '/portal', 'nor one that resolves to another origin')
  assert.equal(landing({ asked: '/\\evil.example', screens: portal }), '/portal', 'a backslash is no path of this origin')
  assert.equal(landing({ asked: '/portal%2f..', screens: portal }), '/portal', 'an encoded slash names no page of the portal')
  assert.equal(landing({ asked: 'javascript:alert(1)', screens: portal }), '/portal', 'and a scheme is no path')
  assert.equal(landing({ asked: '/PORTAL', screens: portal }), '/portal', 'a path is matched as it is spelled')
  assert.equal(landing({ asked: '/portal/courses#top', screens: portal }), '/portal/courses#top', 'while a page keeps its fragment')
  assert.equal(landing({ asked: undefined, screens: both }), '/unauthorized', 'someone who opens several screens is asked which')
  assert.equal(landing({ asked: '/dashboard/courses', screens: both }), '/dashboard/courses', 'unless they asked for one of them')
  assert.equal(landing({ asked: '/portal', screens: [] }), '/unauthorized', 'and someone who opens none is told why')
})

test('the path a redirect carries is read as the browser resolves it, and one that resolves to another origin is refused', () => {
  assert.equal(wanted({ asked: '/..//evil.example', home: '/' }), '/', 'a dot segment that leaves `//` behind is another origin')
  assert.equal(wanted({ asked: '/portal/%2e%2e/dashboard?tab=1#top', home: '/' }), '/dashboard?tab=1#top', 'and an encoded one is resolved, keeping the search and the fragment')
})
