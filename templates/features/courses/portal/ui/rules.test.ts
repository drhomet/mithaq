import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byWhen, closedTo, feeOf, nextByCourse, partOfDay, seatsOf, startsIn } from './rules.ts'

const t = (key: string, fallback?: string) => fallback ?? key
const now = Date.parse('2026-10-15T12:00:00Z')

test('a greeting names the part of the viewer\'s day', () => {
  assert.deepEqual([5, 11, 12, 17, 18, 23].map(partOfDay), ['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening'])
})

test('each course\'s next session is the first still to start, never one past or archived', () => {
  const next = nextByCourse([
    { id: 'old', course: 'a', startsAt: '2026-10-01T09:00:00Z' },
    { id: 'later', course: 'a', startsAt: '2026-11-01T09:00:00Z' },
    { id: 'soon', course: 'a', startsAt: '2026-10-20T09:00:00Z' },
    { id: 'shut', course: 'b', startsAt: '2026-10-16T09:00:00Z', archived: true },
    { id: 'b1', course: 'b', startsAt: '2026-10-18T09:00:00Z' },
  ], now)
  assert.deepEqual([...next].map(([course, one]) => [course, one.id]).sort(), [['a', 'soon'], ['b', 'b1']])
})

test('a viewer\'s seats are split into those to come, soonest first, and those past, latest first; a seat whose session is unread is neither', () => {
  const seats = [
    { id: '1', startsAt: '2026-10-01T09:00:00Z' },
    { id: '2', startsAt: '2026-11-01T09:00:00Z' },
    { id: '3', startsAt: '2026-10-20T09:00:00Z' },
    { id: '4', startsAt: '2026-09-01T09:00:00Z' },
    { id: '5' },
  ]
  const { upcoming, past } = byWhen(seats, now)
  assert.deepEqual(upcoming.map((one) => one.id), ['3', '2'])
  assert.deepEqual(past.map((one) => one.id), ['1', '4'])
})

test('a fee reads in its currency, nought reads as free, and none says nothing', () => {
  assert.equal(feeOf({ fee: 50, currency: 'USD', locale: 'en', t }), '$50.00')
  assert.equal(feeOf({ fee: 0, currency: 'USD', locale: 'en', t }), 'Free')
  assert.equal(feeOf({ fee: null, currency: 'USD', locale: 'en', t }), undefined)
  assert.equal(feeOf({ fee: 12, currency: 'nope', locale: 'en', t }), '12', 'a currency Intl refuses keeps the number')
})

test('a session with no capacity says nothing of seats, a full one says so, and any other counts what is left', () => {
  const words = (key: string, fallback?: string) => ({ 'portal.seatsLeft_one': '{count} seat left', 'portal.seatsLeft_other': '{count} seats left' } as Record<string, string>)[key] ?? fallback
  assert.equal(seatsOf({ seatsLeft: null, locale: 'en', t: words }), undefined)
  assert.equal(seatsOf({ seatsLeft: 0, locale: 'en', t: words }), 'Full')
  assert.equal(seatsOf({ seatsLeft: 1, locale: 'en', t: words }), '1 seat left')
  assert.equal(seatsOf({ seatsLeft: 12, locale: 'en', t: words }), '12 seats left')
})

test('how soon a session starts is said in hours under a day and in days past one', () => {
  assert.equal(startsIn({ value: '2026-10-15T15:00:00Z', now, locale: 'en' }), 'in 3 hours')
  assert.equal(startsIn({ value: '2026-10-16T12:00:00Z', now, locale: 'en' }), 'tomorrow')
  assert.equal(startsIn({ value: '2026-10-21T12:00:00Z', now, locale: 'en' }), 'in 6 days')
  assert.equal(startsIn({ value: undefined, now, locale: 'en' }), undefined)
})

test('maintenance closes the portal to a student alone: whoever runs the dashboard or reads every seat keeps working, and it is open while maintenance is off', () => {
  const student = { screens: ['portal'], collections: { enrollments: { operations: { find: true } } } }
  const instructor = { screens: ['portal'], collections: { enrollments: { operations: { find: true, others: true } } } }
  const staff = { screens: ['portal', 'dashboard'] }
  assert.equal(closedTo({ maintenance: true, access: student }), true)
  assert.equal(closedTo({ maintenance: true, access: instructor }), false)
  assert.equal(closedTo({ maintenance: true, access: staff }), false)
  assert.equal(closedTo({ maintenance: true, access: { permissions: '*' } }), false, 'nor the administrator, who holds every key')
  assert.equal(closedTo({ maintenance: false, access: student }), false)
  assert.equal(closedTo({ maintenance: null, access: student }), false)
})
