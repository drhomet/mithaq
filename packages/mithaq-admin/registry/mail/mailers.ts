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
    console.log(`[asas mail] To ${to}: ${subject}\n${text}`)
  },
}

/**
 * Resend's HTTP API over `fetch`, so no SDK is installed. `from` is an address at a domain the Resend
 * account verified. A refusal throws with the status alone: the address and the body stay out of the log.
 */
export const resendMailer = ({ apiKey, from }: { apiKey: string; from: string }): Mailer => ({
  send: async ({ to, subject, text, html }) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    })
    if (!response.ok) throw new Error(`Resend refused a message: ${response.status} ${response.statusText}`)
  },
})
