// Which mailer this project sends with. `mailers.ts` beside this file is copied from the
// `mithaq-mail` registry item and owned by the project; a project on another service writes its
// adapter there and names it here. The auth setup sends the password reset, the invitation and the
// email verification through it, and refuses an open sign-up in production while none is configured.
import { resendMailer, type Mailer } from './mailers.ts'

export { logMailer, type Mail, type Mailer } from './mailers.ts'

/**
 * Resend when both `RESEND_API_KEY` and `MAIL_FROM` are set, none when neither is. Half the settings
 * is refused, so a typo never leaves a deploy sending nothing while it seems configured.
 */
export const mailerFromEnv = (env: Record<string, string | undefined>): Mailer | undefined => {
  const { RESEND_API_KEY: apiKey, MAIL_FROM: from } = env
  if (!apiKey && !from) return undefined
  if (!apiKey) throw new Error('MAIL_FROM is set and RESEND_API_KEY is not. Set both, or neither.')
  if (!from) throw new Error('RESEND_API_KEY is set and MAIL_FROM is not: set MAIL_FROM to an address at a domain your Resend account verified.')
  return resendMailer({ apiKey, from })
}

/** The mailer this deploy configured, or none; the auth setup logs mail in development without one. */
export const configuredMailer = mailerFromEnv(process.env)
