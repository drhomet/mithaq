import {
  defaultFields,
  defaultLockTime,
  defaultMaxLoginAttempts,
  defaultTokenExpiration,
  local,
  localAuthFields,
  localAuthOperations,
  defaultOperations,
  type Ctx,
} from 'mithaq'
import { defineKayan, requestContext } from '../../../mithaq.ts'
import { appPage, platformList } from '../../../mithaq/pages.ts'
import { superAdmin } from '../../../roles/tenant-access.ts'

/**
 * The trusted-header names this deployment's own proxy overwrites with the real client address, read
 * from the same `TRUSTED_IP_HEADER` variable Better Auth's `advanced.ipAddress.ipAddressHeaders` is
 * fed from, so both limiters key on the same address. Unset, it falls back to `x-forwarded-for`.
 */
export const ip = (request: Request): string | null => {
  const headers = process.env.TRUSTED_IP_HEADER?.split(',').map((header) => header.trim()).filter(Boolean) ?? [
    'x-forwarded-for',
  ]
  for (const header of headers) {
    const value = request.headers.get(header)?.split(',').at(-1)?.trim()
    if (value) return value
  }
  return null
}

/**
 * The secret local auth signs its tokens with, 32 characters at least, from the environment and
 * never from this file: a secret written here is one anyone reading the repository forges a token
 * with. Unset or empty, local auth is off as a whole: every POST to `/api/auth/local` answers
 * `withoutSecret` below with a 503, and the public sign-up with a 403. The kayan keeps its provider,
 * fields and operations, so the build and every file generated from it are the same in every
 * environment.
 */
const secret = process.env.LOCAL_AUTH_SECRET || undefined

const markVerified = (ctx: Ctx): Ctx => ({ ...ctx, data: { ...ctx.data, _verified: true } })

/**
 * The kayan the local auth provider writes. It spreads the shipped `localAuthFields` and
 * `localAuthOperations`, so every column and step it has is written here, and the build refuses a
 * protected column left readable.
 */
export const localUsers = defineKayan({
  name: 'localUsers',
  dbName: 'local_users',
  messages: {
    singular: { en: 'Local account', ar: 'حساب محلي' },
    plural: { en: 'Local accounts', ar: 'الحسابات المحلية' },
  },
  // `context` is what first registration hands its steps.
  //
  // `ip` reads the last entry of whichever header `TRUSTED_IP_HEADER` names, the one the trusted proxy
  // in front of it appended, because no host this template is served by hands the socket address to
  // the `Request`. That is only safe behind exactly one such proxy: without one any caller writes the
  // header, and behind more than one the last entry is the nearest proxy's own address, so every user
  // would share one count; there, take the entry at the depth of the trusted proxies. A project served
  // bare passes its server's own address instead, such as Bun's `server.requestIP(request)`. No header
  // answers null, which leaves the request uncounted.
  // No `email` is passed, so no mail is sent: a super admin verifies each sign-up in the platform app.
  auth: local({
    secret,
    withoutSecret: 'Local sign-in is off on this server: LOCAL_AUTH_SECRET is not set. Set it to a secret of 32 characters at least and restart the server.',
    context: requestContext,
    ip,
    tokenExpiration: defaultTokenExpiration,
    maxLoginAttempts: defaultMaxLoginAttempts,
    lockTime: defaultLockTime,
  }),
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        ...localAuthOperations,
        // The provider's own update with one step before it that writes `_verified: true` over whatever
        // the call sent, so it can only verify; the access below judges it as an update with that one key
        // as its data.
        verify: { ...localAuthOperations.update, steps: [markVerified, ...localAuthOperations.update.steps] },
      },
    },
    /**
     * Where a super admin verifies a sign-up: the accounts by email, verified state and the date each
     * was made, and an edit page whose form is the verified toggle alone. Its fields are written here,
     * never read off `/api/access`, which reports `update` for `email` because the kayan's own `update`
     * asks the data and the report has none; the access above still refuses any write but `_verified`.
     * The form sends only what changed, so an unchanged toggle writes nothing and leaves `updatedAt`
     * alone. The protected columns are named by no page, so no list offers one as a column or a filter.
     */
    platform: {
      useAsTitle: 'email',
      pages: {
        ...platformList('/local-users', {
          columns: ['email', '_verified', 'createdAt'],
          filters: ['_verified'],
          search: ['email'],
          row: [{
            button: 'verify',
            when: { or: [{ 'record._verified': { exists: false } }, { 'record._verified': { equals: false } }] },
            label: { en: 'Verify', ar: 'توثيق' },
            confirm: {
              title: { en: 'Verify this account?', ar: 'توثيق هذا الحساب؟' },
              body: { en: 'Its owner can sign in from now on.', ar: 'يستطيع صاحبه تسجيل الدخول من الآن.' },
            },
          }],
        }),
        // Read-only above the toggle: a read-only leaf is drawn and never sent, so a save still writes
        // `_verified` alone.
        edit: {
          path: '/local-users/:id',
          page: appPage([{ layout: 'record', main: [{ form: [{ section: 'verification', label: { en: 'Verification', ar: 'التحقق' }, fields: [
            { field: 'email', readOnly: true },
            { field: 'createdAt', readOnly: true },
            '_verified',
          ] }] }] }]),
        },
      },
    },
  },
  // Public sign-up stays open. A super admin, in the platform app alone, verifies an account by writing
  // `_verified: true`, which the field's own write admits from the administrator and nobody else. The
  // super admin writes `_verified` and nothing else: a password or an email it set would be an account
  // it could then log in as, and no audit entry records a write to a kayan with no tenant. An
  // `updateMany` is asked this again for each row it writes, with that row's values. Everyone else, a
  // local user on its own row included, reads and writes none.
  access: {
    create: () => true,
    read: superAdmin,
    update: ({ user, data }) => superAdmin({ user }) && Object.keys(data ?? {}).every((key) => key === '_verified'),
    delete: () => false,
  },
  // A label leaves the shipped access in place, which the build compares by identity.
  fields: {
    ...defaultFields,
    ...localAuthFields,
    email: { ...localAuthFields.email, label: { en: 'Email', ar: 'البريد الإلكتروني' } },
    _verified: { ...localAuthFields._verified, label: { en: 'Verified', ar: 'موثق' } },
  },
})
