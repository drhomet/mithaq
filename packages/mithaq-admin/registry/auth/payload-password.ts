// Signs in the users a project brought over from Payload with the passwords they already have, so
// moving off Payload asks nobody to reset theirs. It is temporary: each Payload hash is replaced
// with Better Auth's own the first time its user signs in, and the project deletes this file once
// every imported user has signed in, or once the window it gives them closes.
//
//   betterAuth({
//     emailAndPassword: { enabled: true, password: payloadPassword() },
//     plugins: [payloadRehash()],
//   })
//
// Payload stores `salt` and `hash` in two columns; Better Auth's `verify` reads one, so each user's
// pair is imported as one string (`payloadHashToAccountPassword`) whose prefix names the scheme:
// `payload-pbkdf2$` for a hash Payload 3.89 or older wrote, `payload-pbkdf2-v1$` for a 3.90 one.
//
// ponytail: the rehash is a sign-in hook because Better Auth's `verify` answers a boolean alone.
// Once it can answer that a hash needs replacing (better-auth/better-auth#10291), that answer
// replaces the plugin.
import { pbkdf2, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { BASE_ERROR_CODES, type BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { hashPassword, verifyPassword } from 'better-auth/crypto'

// Payload's two pbkdf2-sha256 schemes, as `generatePasswordSaltHash.ts` derives them at v3.89.0 and v3.90.0.
const schemes = {
  'payload-pbkdf2': { iterations: 25000, keyLength: 512 },
  'payload-pbkdf2-v1': { iterations: 600000, keyLength: 32 },
}

// Async, so 600000 iterations run on libuv's pool and not the event loop.
const derive = promisify(pbkdf2)
const hex = /^(?:[0-9a-f]{2})+$/i

/** The scheme, salt and key a stored string holds, or nothing when it is not one this file wrote. */
const parsed = (stored: string) => {
  const [prefix = '', salt = '', key = '', ...rest] = stored.split('$')
  const scheme = Object.hasOwn(schemes, prefix) ? schemes[prefix as keyof typeof schemes] : undefined
  if (!scheme || rest.length || !hex.test(salt) || !hex.test(key) || key.length !== scheme.keyLength * 2) return undefined
  return { ...scheme, salt, key: Buffer.from(key, 'hex') }
}

/** Better Auth's `emailAndPassword.password`: new passwords are Better Auth's scrypt, and a Payload hash still verifies. */
export const payloadPassword = () => ({
  hash: hashPassword,
  verify: async ({ hash, password }: { hash: string; password: string }) => {
    if (!hash.startsWith('payload-pbkdf2')) {
      // Better Auth's own throws on a value that is not `salt:key`, which would answer the sign-in a 500.
      return verifyPassword({ hash, password }).catch(() => false)
    }
    const stored = parsed(hash)
    if (!stored) return false
    // Payload hands pbkdf2 the salt as its hex text, and the password as typed: no NFKC, unlike Better Auth.
    // `parsed` held the stored key to the scheme's length, so the compare never throws on a short one.
    return timingSafeEqual(await derive(password, stored.salt, stored.iterations, stored.keyLength, 'sha256'), stored.key)
  },
})

const signIns = (ctx: { path?: string }) => ctx.path === '/sign-in/email' || ctx.path === '/sign-in/username'

/**
 * Replaces a Payload hash with Better Auth's own after its user signs in with it. Better Auth's
 * sign-in never checks `maxPasswordLength`, which only caps a password being set, so this refuses
 * a longer one before it reaches `verify`: nobody could have set it, and 600000 iterations on
 * whatever a caller sends is work nobody asked for.
 */
export const payloadRehash = () => ({
  id: 'payload-rehash',
  hooks: {
    before: [{
      matcher: signIns,
      handler: createAuthMiddleware(async (ctx) => {
        const { password } = (ctx.body ?? {}) as { password?: unknown }
        if (typeof password === 'string' && password.length > ctx.context.password.config.maxPasswordLength) throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.PASSWORD_TOO_LONG)
      }),
    }],
    after: [{
      matcher: signIns,
      handler: createAuthMiddleware(async (ctx) => {
        const { password } = (ctx.body ?? {}) as { password?: unknown }
        const userId = ctx.context.newSession?.user.id
        if (!userId || typeof password !== 'string' || ctx.context.returned instanceof Error) return
        // As Payload's own `login.ts` rehashes: the sign-in already succeeded, so a failure is logged
        // and the next sign-in tries again.
        try {
          const account = await ctx.context.internalAdapter.findCredentialAccount(userId)
          if (!account?.password?.startsWith('payload-pbkdf2')) return
          // Only over the hash that was read, so a password set meanwhile (a reset in another tab) stands.
          await ctx.context.adapter.updateMany({
            model: 'account',
            where: [{ field: 'id', value: account.id }, { field: 'password', value: account.password }],
            update: { password: await ctx.context.password.hash(password) },
          })
        } catch (error) {
          ctx.context.logger.error('A Payload password was not replaced with Better Auth\'s hash; the next sign-in tries again.', error)
        }
      }),
    }],
  },
}) satisfies BetterAuthPlugin

/**
 * The string `account.password` holds for one Payload user, from its `salt` and `hash` columns,
 * for a cutover script. It throws on a pair Payload never wrote, so nothing unverifiable is imported.
 */
export const payloadHashToAccountPassword = ({ salt, hash }: { salt: string; hash: string }) => {
  const current = typeof hash === 'string' && hash.startsWith('pbkdf2-sha256-v1:')
  const stored = `${current ? 'payload-pbkdf2-v1' : 'payload-pbkdf2'}$${salt}$${current ? hash.slice('pbkdf2-sha256-v1:'.length) : hash}`
  if (typeof salt !== 'string' || typeof hash !== 'string' || !parsed(stored)) throw new Error('This salt and hash is not a password Payload wrote, so it is not imported.')
  return stored
}
