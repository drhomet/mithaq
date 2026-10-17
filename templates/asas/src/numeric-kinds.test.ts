import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultMaxBodyBytes, AsasError, base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, defineMithaq, fetchHttp, zodKinds, zodRules, zodIdKinds, zodTarget, type Where } from 'mithaq'
import { memoryStore } from './memory-store.ts'
import { plainTarget } from './standard-schema-target.ts'

const zod = zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds })

const allowAccess = { create: () => true, read: () => true, update: () => true, delete: () => true } as const
const language = (schema: typeof zod | typeof plainTarget = zod) =>
  defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: schema,
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
    },
  })
const refused = (error: unknown) => error instanceof AsasError && error.status === 400

test('an integer is written and read as an int4, and a fraction, a value that is not finite or one past int4 is refused before storage', async () => {
  const { defineKayan, buildAsas } = language()
  const measures = defineKayan({
    name: 'measures',
    access: allowAccess,
    fields: { ...defaultFields, count: { kind: 'integer', label: { en: 'Count', ar: 'العدد' }, rules: { required: true } } },
    targets: { service: { operations: defaultOperations } },
  })
  const operations = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [measures] }).kayan.measures.operations
  for (const count of [-2147483648, 0, 2147483647]) {
    const row = await operations.create({ id: crypto.randomUUID(), count })
    assert.equal((await operations.findByID({ id: row.id }))?.count, count)
  }
  for (const count of [1.5, Number.NaN, Infinity, -Infinity, -2147483649, 2147483648, '3']) {
    await assert.rejects(() => operations.create({ count } as never), refused)
  }
  assert.equal((await operations.count({})).totalDocs, 3)
})

test('a decimal is written and read as its exact text, and text that is no decimal, past its scale or past its precision is refused before storage', async () => {
  const { defineKayan, buildAsas } = language()
  const prices = defineKayan({
    name: 'prices',
    access: allowAccess,
    fields: { ...defaultFields, amount: { kind: 'decimal', label: { en: 'Amount', ar: 'المبلغ' }, rules: { required: true, precision: 20, scale: 2 } } },
    targets: { service: { operations: defaultOperations } },
  })
  const operations = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [prices] }).kayan.prices.operations
  // 9007199254740993 is the first whole number a JS double cannot hold.
  for (const amount of ['9007199254740993.12', '-999999999999999999.99', '0.01', '0000.20']) {
    const row = await operations.create({ id: crypto.randomUUID(), amount })
    assert.equal((await operations.findByID({ id: row.id }))?.amount, amount)
  }
  for (const amount of ['1.234', '1000000000000000000.00', 'NaN', 'Infinity', '1e3', '', ' 1.2', '1.2.3', '.5', 1.2]) {
    await assert.rejects(() => operations.create({ amount } as never), refused, String(amount))
  }
  assert.equal((await operations.count({})).totalDocs, 4)
})

test('a decimal field declares a precision and a scale or neither, and a scale no greater than its precision', () => {
  const { defineKayan, buildAsas } = language()
  const build = (rules: Record<string, unknown>) => () =>
    buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [defineKayan({ name: 'sized', fields: { ...defaultFields, amount: { kind: 'decimal', rules } as never }, targets: { service: { operations: defaultOperations } } })],
    })
  assert.throws(build({ precision: 7 }), /field "amount" declares precision and needs scale too, or neither/)
  assert.throws(build({ scale: 2 }), /field "amount" declares scale and needs precision too, or neither/)
  assert.throws(build({ precision: 2, scale: 3 }), /field "amount" needs a scale no greater than its precision/)
  for (const rules of [{ precision: 0, scale: 0 }, { precision: 1001, scale: 0 }, { precision: 7.5, scale: 2 }, { precision: 7, scale: -1 }]) {
    assert.throws(build(rules), /nested rule "(precision|scale)" has an invalid value type/, JSON.stringify(rules))
  }
  for (const rules of [{}, { precision: 7, scale: 2 }, { precision: 1, scale: 0 }, { precision: 2, scale: 2 }, { precision: 1000, scale: 1000 }]) {
    assert.doesNotThrow(build(rules), JSON.stringify(rules))
  }
  assert.throws(
    () => buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [defineKayan({ name: 'counted', fields: { ...defaultFields, count: { kind: 'integer', rules: { precision: 7 } } as never }, targets: { service: { operations: defaultOperations } } })] }),
    /kind "integer" which does not accept nested rule "precision"/,
  )
})

test('an unsized decimal holds any fixed-point text through both schema targets, and refuses what is no decimal', async () => {
  for (const schema of [zod, plainTarget]) {
    const { defineKayan, buildAsas } = language(schema)
    const ledger = defineKayan({
      name: 'ledger',
      access: allowAccess,
      fields: { ...defaultFields, balance: { kind: 'decimal', rules: { required: true, min: '-1' } } },
      targets: { service: { operations: defaultOperations } },
    })
    const operations = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [ledger] }).kayan.ledger.operations
    for (const balance of ['0', '1.234567890123456789012345678901234567890', '9007199254740993.123', '123456789012345678901234567890.5', '0.5']) {
      assert.equal((await operations.findByID({ id: (await operations.create({ id: crypto.randomUUID(), balance })).id }))?.balance, balance)
    }
    for (const balance of ['-1.01', 'NaN', '1e3', '', '1.2.3', 1.2]) await assert.rejects(() => operations.create({ balance } as never), refused, String(balance))
  }
})

test('a decimal bound is text compared as an exact value, negatives and digits past a double included, and a bound above its upper one is refused at build', async () => {
  const { defineKayan, buildAsas } = language()
  const bounded = defineKayan({
    name: 'boundedPrices',
    access: allowAccess,
    fields: {
      ...defaultFields,
      amount: { kind: 'decimal', rules: { precision: 20, scale: 2, min: '2', max: '10' } },
      negative: { kind: 'decimal', rules: { precision: 20, scale: 2, min: '-10', max: '-2' } },
      exact: { kind: 'decimal', rules: { precision: 20, scale: 2, min: '9007199254740993.12', max: '9007199254740993.13' } },
      count: { kind: 'integer', rules: { min: 2, max: 10 } },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const operations = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [bounded] }).kayan.boundedPrices.operations
  await operations.create({ id: crypto.randomUUID(), amount: '9.99', negative: '-9.99', exact: '9007199254740993.12', count: 10 })
  // '10.01' is above '10' and '9.99' below '10' as values, and the other way round as strings.
  for (const data of [{ amount: '1.99' }, { amount: '10.01' }, { negative: '-1.99' }, { negative: '-10.01' }, { exact: '9007199254740993.11' }, { exact: '9007199254740993.14' }, { count: 1 }, { count: 11 }]) {
    await assert.rejects(() => operations.create(data), refused, JSON.stringify(data))
  }
  const impossible = (rules: Record<string, unknown>, kind = 'decimal') => () =>
    buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [defineKayan({ name: 'impossible', fields: { ...defaultFields, amount: { kind, rules } as never }, targets: { service: { operations: defaultOperations } } })] })
  // As text '9' is above '10'; as a value it is not, so this builds.
  assert.doesNotThrow(impossible({ precision: 7, scale: 2, min: '9', max: '10' }))
  assert.throws(impossible({ precision: 7, scale: 2, min: '10', max: '9.5' }), /declares "min" "10" and "max" "9.5", and no value is both at once/)
  assert.throws(impossible({ precision: 7, scale: 2, min: 2 }), /nested rule "min" does not match kind "decimal"/)
  assert.throws(impossible({ min: 1.5 }, 'integer'), /nested rule "min" does not match kind "integer"/)
  assert.throws(impossible({ precision: 7, scale: 2, defaultValue: 1 }), /nested rule "defaultValue" does not match kind "decimal"/)
})

test('a where on an integer reads numeric text as a number and refuses a fraction, and one on a decimal takes its text and refuses a number', async () => {
  const { defineKayan, buildAsas } = language()
  const filtered = defineKayan({
    name: 'filteredMeasures',
    access: allowAccess,
    fields: { ...defaultFields, quantity: { kind: 'integer' }, amount: { kind: 'decimal', rules: { precision: 7, scale: 2 } } },
    targets: { service: { operations: defaultOperations } },
  })
  const operations = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [filtered] }).kayan.filteredMeasures.operations
  for (const [quantity, amount] of [[2, '2.00'], [9, '9.99'], [10, '10.00']] as const) await operations.create({ id: crypto.randomUUID(), quantity, amount })
  assert.deepEqual((await operations.find({ where: { quantity: { greater_than: 2 } }, sort: '-quantity' })).docs.map((one) => one.quantity), [10, 9])
  assert.deepEqual((await operations.find({ where: { quantity: { in: ['2', '9'] } }, sort: 'quantity' } as never)).docs.map((one) => one.quantity), [2, 9])
  assert.deepEqual((await operations.find({ where: { amount: { equals: '9.99' } } })).docs.map((one) => one.quantity), [9])
  const refusals: [Where, string][] = [
    [{ quantity: { equals: 1.5 } }, 'where.quantity.equals'],
    [{ quantity: { equals: '1.5' } }, 'where.quantity.equals'],
    [{ quantity: { in: [2, 2147483648] } }, 'where.quantity.in.1'],
    [{ amount: { less_than: 'NaN' } }, 'where.amount.less_than'],
    [{ amount: { equals: 1.2 } } as never, 'where.amount.equals'],
  ]
  for (const [where, at] of refusals) {
    const thrown = await operations.find({ where }).catch((error: unknown) => error)
    assert.ok(refused(thrown), JSON.stringify(where))
    assert.deepEqual(((thrown as AsasError).params.issues as { path: string }[]).map((one) => one.path), [at], JSON.stringify(where))
  }
  for (const where of [{ quantity: { contains: '1' } }, { amount: { like: '1' } }] as Where[]) await assert.rejects(() => operations.find({ where }), refused)
})

test('the plain schema target refuses the same values of both kinds before storage', async () => {
  const { defineKayan, buildAsas } = language(plainTarget)
  const plain = defineKayan({
    name: 'plainMeasures',
    access: allowAccess,
    fields: { ...defaultFields, quantity: { kind: 'integer' }, amount: { kind: 'decimal', rules: { precision: 7, scale: 2, min: '2', max: '10' } } },
    targets: { service: { operations: defaultOperations } },
  })
  const operations = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [plain] }).kayan.plainMeasures.operations
  assert.equal((await operations.create({ id: crypto.randomUUID(), quantity: 9, amount: '9.99' })).amount, '9.99')
  for (const data of [{ quantity: 1.5 }, { quantity: 2147483648 }, { amount: '1.234' }, { amount: '100000.00' }, { amount: '1.99' }, { amount: '10.01' }, { amount: 'NaN' }, { amount: 9.99 }]) {
    await assert.rejects(() => operations.create(data as never), refused, JSON.stringify(data))
  }
})

test('a field of either kind seeds its refusals in Arabic and English, from the kinds\' and rules\' own sentences', () => {
  const { defineKayan, buildAsas } = language()
  const { messages } = buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [defineKayan({
      name: 'copied',
      access: allowAccess,
      fields: { ...defaultFields, quantity: { kind: 'integer', rules: { min: 2 } }, amount: { kind: 'decimal', rules: { precision: 7, scale: 2 } } },
      targets: { service: { operations: defaultOperations } },
    })],
  })
  const floor = messages.scopes.find((scope) => scope.name === 'mithaq')!.keys
  assert.deepEqual(floor['kinds.integer'], { en: 'Integer', ar: 'عدد صحيح' })
  assert.deepEqual(floor['kinds.decimal'], { en: 'Decimal', ar: 'عدد عشري' })
  assert.deepEqual(floor['kinds.integer.invalid'], { en: 'This is not a 32-bit integer.', ar: 'هذا ليس عددا صحيحا من 32 بت.' })
  assert.deepEqual(floor['kinds.decimal.invalid'], { en: 'This is not a decimal number.', ar: 'هذا ليس عددا عشريا.' })
  assert.deepEqual(floor['rules.precision'], { en: 'The value has too many digits.', ar: 'القيمة فيها أرقام أكثر من المسموح.' })
  assert.deepEqual(floor['rules.scale'], { en: 'The value has too many decimal places.', ar: 'القيمة فيها منازل عشرية أكثر من المسموح.' })
  const keys = messages.scopes.find((scope) => scope.name === 'copied')!.keys
  for (const key of ['quantity.invalid', 'quantity.min', 'amount.invalid', 'amount.precision', 'amount.scale']) {
    for (const locale of ['ar', 'en']) assert.equal(typeof (keys[key] as Record<string, string> | undefined)?.[locale], 'string', `${key} in ${locale}`)
  }
})

test('an access constraint comparing an integer or a decimal to a value its kind refuses is refused by name before any store is asked', async () => {
  for (const [constraint, kind] of [
    [{ quantity: { equals: 1.5 } }, 'integer'],
    [{ quantity: { in: [2, 2147483648] } }, 'integer'],
    // Text a number reads but Postgres's integer input does not.
    [{ quantity: { equals: '1.0' } }, 'integer'],
    [{ quantity: { in: ['2', '1e3'] } }, 'integer'],
    [{ amount: { greater_than: 'NaN' } }, 'decimal'],
    [{ amount: { equals: 9.99 } }, 'decimal'],
  ] as const) {
    const { defineKayan, buildAsas } = language()
    const guarded = defineKayan({
      name: 'guarded',
      access: { ...allowAccess, read: () => constraint as never },
      fields: { ...defaultFields, quantity: { kind: 'integer' }, amount: { kind: 'decimal', rules: { precision: 7, scale: 2 } } },
      targets: { service: { operations: defaultOperations } },
    })
    const operations = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [guarded] }).kayan.guarded.operations
    await assert.rejects(() => operations.find({}), new RegExp(`needs a value of kind "${kind}"`), JSON.stringify(constraint))
  }
  const { defineKayan, buildAsas } = language()
  const open = defineKayan({
    name: 'open',
    access: { ...allowAccess, read: () => ({ quantity: { exists: true }, amount: { not_equals: null } }) },
    fields: { ...defaultFields, quantity: { kind: 'integer' }, amount: { kind: 'decimal', rules: { precision: 7, scale: 2 } } },
    targets: { service: { operations: defaultOperations } },
  })
  assert.equal((await buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [open] }).kayan.open.operations.find({})).totalDocs, 0)
})
