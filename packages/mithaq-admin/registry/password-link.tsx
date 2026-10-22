import { useRef, useState } from 'react'
import { useLocale } from 'mithaq/admin/react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** The bearer is shown only to the operator who asked for it, never in a toast or activity row. */
export function PasswordLink({ link, expiresAt, phone, cancel, emailFailed }: { link: string; expiresAt: string; phone?: string; emailFailed?: boolean; cancel: () => Promise<void> }) {
  const { locale, t } = useLocale()
  const [cancelled, setCancelled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [refusal, setRefusal] = useState(false)
  const share = new URL(`https://wa.me/${phone?.replace(/\D/g, '').replace(/^00/, '') ?? ''}`)
  share.searchParams.set('text', `${t('dashboard.passwordLinkMessage', 'Choose your password using this one-time link:')} ${link}`)
  if (cancelled) return <p role="status">{t('dashboard.passwordLinkCancelled', 'Link cancelled')}</p>
  return (
    <div data-password-link="" className="grid min-w-0 gap-3">
      {emailFailed ? <p role="status">{t('dashboard.passwordLinkEmailFailed', 'Email could not be sent. Copy or share this link instead.')}</p> : null}
      <p>{t('dashboard.passwordLinkPrivate', 'Share this link with this person alone. It chooses their password and works once.')}</p>
      <Input readOnly dir="ltr" value={link} aria-label={t('dashboard.link', 'Link')} className="min-h-11 min-w-0" onFocus={(event) => event.currentTarget.select()} />
      <p className="text-muted-foreground text-sm">{t('dashboard.inviteExpires', 'Expires')}: <time dateTime={expiresAt}>{new Date(expiresAt).toLocaleString(locale)}</time></p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setRefusal(true))}>{copied ? t('dashboard.inviteCopied', 'Link copied') : t('dashboard.inviteCopy', 'Copy link')}</Button>
        <a href={share.href} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>{t('dashboard.passwordLinkWhatsApp', 'Send by WhatsApp')}</a>
      </div>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => {
        setBusy(true)
        setRefusal(false)
        void cancel().then(() => setCancelled(true)).catch(() => setRefusal(true)).finally(() => setBusy(false))
      }}>{t('dashboard.passwordLinkCancel', 'Cancel link')}</Button>
      {refusal ? <p role="alert" className="text-destructive">{t('auth.requestFailed', 'That request did not work.')}</p> : null}
    </div>
  )
}

/** The member record asks the same provider endpoint as the directory's row action. */
export function IssuePasswordLink({ userId, phone, authArm }: { userId: string; phone?: string; authArm: (path: string, body: Record<string, unknown>) => Promise<{ ok: boolean; body: Record<string, unknown> | null }> }) {
  const { t } = useLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  const [issued, setIssued] = useState<{ link: string; expiresAt: string; emailFailed?: boolean }>()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(false)
  return <div className="grid justify-items-start gap-2">
    <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => {
      setBusy(true)
      setRefused(false)
      void authArm('organization/send-password-link', { userId }).then((response) => {
        if (!response.ok || typeof response.body?.link !== 'string' || typeof response.body.expiresAt !== 'string') throw new Error('Issuance refused')
        setIssued({ link: response.body.link, expiresAt: response.body.expiresAt, emailFailed: response.body.emailFailed === true })
        dialog.current?.showModal()
      }).catch(() => setRefused(true)).finally(() => setBusy(false))
    }}>{t('dashboard.passwordLink', 'Issue password link')}</Button>
    {refused ? <p role="alert" className="text-destructive text-sm">{t('dashboard.passwordLinkRefused', 'The server refused to issue that link.')}</p> : null}
    <dialog ref={dialog} data-password-link-sheet="" aria-label={t('dashboard.passwordLink', 'Issue password link')} className="bg-background text-foreground m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/80" onClose={() => setIssued(undefined)}>
      <div className="grid gap-4 p-6 text-sm">
        <h2 className="text-base font-medium">{t('dashboard.passwordLink', 'Issue password link')}</h2>
        {issued ? <PasswordLink key={issued.link} {...issued} phone={phone} cancel={async () => { const response = await authArm('organization/cancel-password-link', { userId }); if (!response.ok) throw new Error('Cancellation refused') }} /> : null}
        <Button type="button" variant="outline" className="min-h-11" onClick={() => dialog.current?.close()}>{t('admin.close', 'Close')}</Button>
      </div>
    </dialog>
  </div>
}
