// Each action is the admin plugin's own route, drawn only where this actor holds its key
// (`user.set-role`, `user.ban` or `user.impersonate`) and refused by the provider without it. None is
// drawn on the viewer's own row, and on a staff member's, a person holding a platform role, only for a
// super admin; the server refuses both whatever is drawn. An action that lands asks the page behind
// it to be read again through `mithaq:refresh`, so the page keeps its scroll.
import { useState, type ReactNode } from 'react'
import { holds, type CellProps, type MenuProps, type Row } from 'mithaq/admin'
import { useAccess, useLocale, useRecord, useUser } from 'mithaq/admin/react'
import { platformRoles } from '@asas/auth/platform-roles'
import { authArm } from '@/api.ts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** The names `set-role` accepts: the platform roles and the plugin's own `user`, which is none of them. */
const roleNames = ['user', ...Object.keys(platformRoles)] as const

/** How long a ban lasts, in the seconds the plugin's `banExpiresIn` takes, or until it is lifted. */
const banEnds = [
  ['', 'platform.banUntilLifted', 'Until it is lifted'],
  ['86400', 'platform.banDay', 'One day'],
  ['604800', 'platform.banWeek', 'Seven days'],
  ['2592000', 'platform.banMonth', 'Thirty days'],
] as const

type Action = 'set-role' | 'ban' | 'unban' | 'impersonate'

/** What a native choice looks like beside the underline `Input`: no box, no corners, the line under it. */
const choiceClass =
  'h-10 w-full rounded-none border border-transparent border-b-input bg-transparent px-0 text-sm outline-none focus-visible:border-b-ring [&>option]:bg-popover [&>option]:text-popover-foreground'

const refusalsByCode: Record<string, [key: string, fallback: string]> = {
  BANNED_USER: ['platform.refusedBanned', 'This person is banned, so they cannot be impersonated.'],
}

const usePlatformRoleLabel = () => {
  const { locale, t } = useLocale()
  return (one: string) =>
    Object.hasOwn(platformRoles, one) ? platformRoles[one as keyof typeof platformRoles].label[locale === 'ar' ? 'ar' : 'en'] : t('platform.noRole', 'No platform role')
}

/** A person's platform roles as badges, each by its label, which a record page draws where the column holds the slugs. */
export function PlatformRole({ value }: Pick<CellProps, 'value'>) {
  const labelOf = usePlatformRoleLabel()
  const role = typeof value === 'string' && value ? value : 'user'
  return (
    <span className="inline-flex flex-wrap gap-1">
      {role.split(',').map((one) => (
        <Badge key={one} variant="secondary">
          {labelOf(one.trim())}
        </Badge>
      ))}
    </span>
  )
}

const usePerson = (row: Row) => {
  const access = useAccess()
  const viewer = useUser()
  const role = typeof row.role === 'string' && row.role ? row.role : 'user'
  const own = typeof row.email === 'string' && row.email === viewer.email
  const staff = role.split(',').some((one) => Object.hasOwn(platformRoles, one.trim()))
  // None on the viewer's own row, and on a staff member's only for a super
  // admin; the server refuses both whatever is drawn.
  const acts = !own && (!staff || access.permissions === '*')
  const actions: Action[] = [
    ...(acts && holds(access, 'user.set-role') ? ['set-role' as const] : []),
    ...(acts && holds(access, 'user.ban') ? [row.banned === true ? ('unban' as const) : ('ban' as const)] : []),
    // A banned account is refused a session, so impersonating it cannot work.
    ...(acts && row.banned !== true && holds(access, 'user.impersonate') ? ['impersonate' as const] : []),
  ]
  return { role, actions }
}

const useNames = () => {
  const { t } = useLocale()
  return { 'set-role': t('platform.setRole', 'Set role'), ban: t('platform.ban', 'Ban'), unban: t('platform.unban', 'Unban'), impersonate: t('platform.impersonate', 'Impersonate') }
}

function PersonDialog({ row, action, onClose }: { row: Row; action: Action; onClose: () => void }) {
  const { t } = useLocale()
  const names = useNames()
  const labelOf = usePlatformRoleLabel()
  const { role } = usePerson(row)
  const [chosen, setChosen] = useState(role)
  const [reason, setReason] = useState('')
  const [ends, setEnds] = useState('')
  const [refusal, setRefusal] = useState<string>()
  const [done, setDone] = useState<string>()
  const [busy, setBusy] = useState(false)
  const userId = String(row.id ?? '')
  const name = String(row.name || row.email || '')
  const send = async () => {
    const [path, body] = {
      'set-role': ['admin/set-role', { userId, role: chosen }],
      ban: ['admin/ban-user', { userId, banReason: reason.trim(), ...(ends ? { banExpiresIn: Number(ends) } : {}) }],
      unban: ['admin/unban-user', { userId }],
      impersonate: ['admin/impersonate-user', { userId }],
    }[action] as [string, Record<string, unknown>]
    setBusy(true)
    const answered = await authArm(path, body).finally(() => setBusy(false))
    // The provider's own sentence is English alone, so the dialog says the
    // refusal in the viewer's locale; the detail stays in the answer's body.
    if (!answered.ok) {
      const known = refusalsByCode[String(answered.body?.code)]
      return setRefusal(known ? t(known[0], known[1]) : t('platform.refused', 'The platform refused that action.'))
    }
    // The platform answers a one-time link into the tenant app, which trades it for the impersonated
    // session under its own cookie.
    if (action === 'impersonate') {
      onClose()
      return window.location.assign(String(answered.body?.url))
    }
    window.dispatchEvent(new Event('mithaq:refresh'))
    setDone(landed[action])
  }
  // Functions, so a name holding `$&` is put in as written and never read as a pattern.
  const fill = (text: string | undefined) => (text ?? '').replace('{name}', () => name).replace('{role}', () => labelOf(chosen) ?? chosen)
  const said = {
    // Asked only once another role is picked: the dialog opens on the role
    // the person holds, which there is nothing to give.
    'set-role': fill(chosen === role ? t('platform.pickRole', 'Pick another platform role for {name}.') : t('platform.confirmRole', 'Give {name} the platform role "{role}"?')),
    ban: fill(t('platform.confirmBan', 'Ban {name}? They are signed out of both apps and cannot sign in until the ban ends.')),
    unban: fill(t('platform.confirmUnban', 'Lift the ban on {name}? They can sign in again.')),
    impersonate: fill(t('platform.confirmImpersonate', 'Impersonate {name}? You act as them in the tenant app until you stop.')),
  }[action]
  const landed = {
    'set-role': fill(t('platform.roleSet', '{name} now holds the platform role "{role}".')),
    ban: fill(t('platform.banned', '{name} is banned.')),
    unban: fill(t('platform.unbanned', 'The ban on {name} is lifted.')),
  }
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-person={userId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{names[action]}</AlertDialogTitle>
          {/* Polite, and drawn before and after the action lands, so the sentence it lands with is read out. */}
          <AlertDialogDescription aria-live="polite">{done ?? said}</AlertDialogDescription>
        </AlertDialogHeader>
        {done ? null : action === 'set-role' ? (
          <div className="grid gap-2">
            <Label htmlFor={`role-${userId}`}>{t('platform.role', 'Platform role')}</Label>
            <select
              id={`role-${userId}`}
              data-role="chosen"
              className={choiceClass}
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            >
              {roleNames.map((one) => (
                <option key={one} value={one}>
                  {labelOf(one)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {!done && action === 'ban' ? (
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`ban-reason-${userId}`}>{t('platform.banReason', 'Reason')}</Label>
              {/* Required, and said so while it is empty, since Ban stays off until a reason is given. */}
              <Input id={`ban-reason-${userId}`} data-ban="reason" required aria-required maxLength={200} aria-describedby={reason.trim() ? undefined : `ban-reason-${userId}-needed`} value={reason} onChange={(event) => setReason(event.target.value)} />
              {reason.trim() ? null : (
                <p id={`ban-reason-${userId}-needed`} className="text-muted-foreground text-sm">
                  {t('platform.banReasonNeeded', 'A ban needs a reason.')}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`ban-ends-${userId}`}>{t('platform.banEnds', 'Ban lasts')}</Label>
              <select
                id={`ban-ends-${userId}`}
                data-ban="ends"
                className={choiceClass}
                value={ends}
                onChange={(event) => setEnds(event.target.value)}
              >
                {banEnds.map(([seconds, key, fallback]) => (
                  <option key={seconds} value={seconds}>
                    {t(key, fallback)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
        {refusal && !done ? (
          <p role="alert" className="text-sm text-destructive">
            {refusal}
          </p>
        ) : null}
        <AlertDialogFooter className="max-sm:[&_button]:h-11">
          <AlertDialogCancel data-button="close">{done ? t('admin.close', 'Close') : t('admin.cancel', 'Cancel')}</AlertDialogCancel>
          {done ? null : (
            <AlertDialogAction
              data-button="confirm"
              variant={action === 'ban' ? 'destructive' : 'default'}
              disabled={busy || (action === 'ban' && !reason.trim()) || (action === 'set-role' && chosen === role)}
              onClick={() => void send()}
            >
              {names[action]}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The actions in a row's menu of the users list, after the list's own View; each opens its dialog below the table, which outlives the menu. */
export function UserMenu({ row, open }: MenuProps<ReactNode>) {
  const names = useNames()
  const { actions } = usePerson(row)
  return actions.map((action) => (
    <DropdownMenuItem key={action} data-action={action} variant={action === 'ban' ? 'destructive' : 'default'} onClick={() => open(<PersonDialog row={row} action={action} onClose={() => open(null)} />)}>
      {names[action]}
    </DropdownMenuItem>
  ))
}

/** The same actions as buttons on the person's own page, which a row opens. */
export function UserButtons() {
  const row = useRecord()
  const names = useNames()
  const { actions } = usePerson(row ?? {})
  const [asking, setAsking] = useState<Action>()
  if (!row || !actions.length) return null
  return (
    <div data-person-actions={actions.join(' ')} className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button key={action} type="button" size="sm" variant={action === 'ban' ? 'destructive' : 'outline'} data-action={action} onClick={() => setAsking(action)}>
          {names[action]}
        </Button>
      ))}
      {asking ? <PersonDialog row={row} action={asking} onClose={() => setAsking(undefined)} /> : null}
    </div>
  )
}
