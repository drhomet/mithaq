import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultFields, defaultIdField, defaultTimestampFields } from '../index.ts'

test('defaultFields is defaultIdField and defaultTimestampFields spread together, in the column order id, updatedAt, createdAt', () => {
  assert.deepEqual(defaultFields, { ...defaultIdField, ...defaultTimestampFields })
  assert.deepEqual(Object.keys(defaultIdField), ['id'])
  assert.deepEqual(Object.keys(defaultTimestampFields), ['updatedAt', 'createdAt'])
  assert.deepEqual(Object.keys(defaultFields), ['id', 'updatedAt', 'createdAt'])
})
