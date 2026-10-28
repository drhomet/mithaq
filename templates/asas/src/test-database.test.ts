import assert from 'node:assert/strict'
import { test } from 'node:test'
import { testDatabase } from './test-database.ts'

test('protected ports are refused, including query overrides', () => {
  for (const port of ['55439', '55480', '5432', '5433', '5173', '5174', '5320', '55620']) {
    for (const url of [
      `postgres://postgres:postgres@127.0.0.1:${port}/mithaq`,
      `postgres://postgres:postgres@127.0.0.1:55603/mithaq?port=55603&port=${port}`,
    ]) assert.throws(() => testDatabase({ DATABASE_URL: url }), new RegExp(`DATABASE_URL names port ${port}`))
  }
})

test('a protected port is refused in every spelling pg reads as that number', () => {
  for (const url of [
    'postgres://postgres:postgres@127.0.0.1:055480/mithaq',
    'postgres://postgres:postgres@127.0.0.1:55603/mithaq?port=055480',
    'postgres://postgres:postgres@127.0.0.1:55603/mithaq?port=+55480',
    'postgres://postgres:postgres@127.0.0.1:55603/mithaq?port=%2B55480',
    'postgres://postgres:postgres@127.0.0.1:55603/mithaq?port=%2055480',
    'postgres://postgres:postgres@127.0.0.1:55603/mithaq?port=55480abc',
    'postgres://postgres:postgres@127.0.0.1:55603/mithaq?port=55480.0',
  ]) assert.throws(() => testDatabase({ DATABASE_URL: url }), /DATABASE_URL names port 55480/, url)
})

test('a test runs only against a throwaway database named mithaq', () => {
  const url = 'postgres://postgres:postgres@127.0.0.1:55603/mithaq'
  assert.equal(testDatabase({ DATABASE_URL: url }), url)
  for (const other of ['mithaq_speed_tests', 'other_app', 'other_audit']) {
    assert.throws(() => testDatabase({ DATABASE_URL: url.replace(/mithaq$/, other) }), /a test only runs against a throwaway one named "mithaq"/)
  }
})
