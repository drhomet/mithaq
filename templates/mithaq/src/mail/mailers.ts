/** One message, written twice: plain text for every client, HTML for those that draw it. */
export type Mail = { to: string; subject: string; text: string; html: string }

/** What sends this project's mail: one function, so an adapter for another service is a few lines. */
export type Mailer = { send(mail: Mail): Promise<void> }

/**
 * Development only: the message goes to the server's log, links and all, and nothing leaves the
 * machine. Never use it in production, where the log would hold every reset and sign-in link.
 */
export const logMailer: Mailer = {
  send: async ({ to, subject, text }) => {
    // The log reads as an inbox, so nobody waits for a message that never left.
    console.log(`[asas mail] Development: emails print here instead of being sent.\nTo ${to}: ${subject}\n${text}`)
  },
}

/** Where Resend's API answers, as its own SDK names it. */
export const defaultResendBaseURL = 'https://api.resend.com'

/**
 * Resend's HTTP API over `fetch`, so no SDK is installed. `from` is an address at a domain the Resend
 * account verified; `baseURL` is another address that speaks Resend's API, such as a test's catcher.
 * A refusal throws with the status alone: the address and the body stay out of the log.
 */
export const resendMailer = ({ apiKey, from, baseURL }: { apiKey: string; from: string; baseURL: string }): Mailer => ({
  send: async ({ to, subject, text, html }) => {
    const response = await fetch(`${baseURL}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    })
    if (!response.ok) throw new Error(`Resend refused a message: ${response.status} ${response.statusText}`)
  },
})
// mithaq-admin 0.0.0 37f2bedf34183fb350814b0e9f4a1453fb4f5491d359794f443461f04bf81e9e
