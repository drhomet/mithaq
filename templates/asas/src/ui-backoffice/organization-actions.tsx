// The list's cell for the `slug` column. Rename is drawn only where this actor holds
// `organization.rename`, with many organizations alone (with one, the name lives in code), and
// members only where this actor reads them; the route refuses a rename without the key. A rename that lands asks the list behind it to be read again through
// `mithaq:refresh`, so the list keeps its scroll.
import { useState, type FormEvent } from 'react'
import { holds, type CellProps } from 'mithaq/admin'
import { useAccess, useLocale, useScreen } from 'mithaq/admin/react'
import { writeQuery } from 'mithaq-admin/list-query.ts'
import { endonym } from 'mithaq-admin/locale-menu.ts'
import { defaultLocale, nameIn, organizationName, organizations } from '@asas/mithaq/auth/organizations'
import { toast } from 'mithaq-admin/toast.tsx'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const slugShape = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function OrganizationActions({ value, row }: CellProps) {
  const { t } = useLocale()
  const access = useAccess()
  const screen = useScreen()
  const renames = organizations === 'many' && holds(access, 'organization.rename')
  // The default locale's name is the required `name` box, so only the others get optional boxes of their own.
  const others = Object.keys(organizationName).filter((one) => one !== defaultLocale)
  const members = holds(access, 'member.find') && screen.kayan.member?.pages.list !== undefined
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string>()
  /** Said here rather than by the browser's own bubble, which is in the browser's language. */
  const [wrong, setWrong] = useState<{ name?: string; slug?: string }>({})
  const id = String(row.id ?? '')
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const box = (key: string) => (event.currentTarget.elements.namedItem(key) as HTMLInputElement | null)?.value ?? ''
    const name = box('name')
    const slug = box('slug')
    // An empty one falls back to `name`, so it is left out.
    const names = { [defaultLocale]: name.trim(), ...Object.fromEntries(others.map((one) => [one, box(`name-${one}`).trim()]).filter(([, one]) => one)) }
    const found = {
      name: name.trim() ? undefined : t('organization.name.required', 'This field is required.'),
      slug: !slug ? t('organization.slug.required', 'This field is required.') : slugShape.test(slug) ? undefined : t('backoffice.slugPattern', 'A slug is lowercase letters and digits joined by single dashes, such as admin-org.'),
    }
    setWrong(found)
    if (found.name || found.slug) return
    const response = await fetch('/api/backoffice/organizations/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, names, slug }),
    })
    if (!response.ok) {
      const key = ((await response.json().catch(() => null)) as { data?: { key?: string } } | null)?.data?.key
      return setRefusal((key && t(key)) ?? t('backoffice.refused', 'The backoffice refused that action.'))
    }
    window.dispatchEvent(new Event('mithaq:refresh'))
    // A function, so a name holding `$&` is put in as written.
    toast.success((t('backoffice.renamed', 'The organization is now named {name}.') ?? '').replace('{name}', () => name))
    setOpen(false)
  }
  return (
    <div data-organization={id} className="flex items-center gap-2 whitespace-nowrap">
      {/* An identifier, read left to right in either locale. */}
      <span dir="ltr">{String(value ?? '')}</span>
      {renames ? (
        <Button size="sm" variant="outline" className="max-sm:h-11" data-action="rename" onClick={() => setOpen(true)}>
          {t('backoffice.rename', 'Rename')}
        </Button>
      ) : null}
      {members ? (
        <Button
          size="sm"
          variant="outline"
          className="max-sm:h-11"
          data-action="members"
          nativeButton={false}
          render={<a href={`${screen.path}${screen.kayan.member!.pages.list!.path}?${new URLSearchParams(writeQuery({ where: { or: [{ and: [{ organizationId: { equals: id } }] }] } }))}`} />}
        >
          {t('backoffice.members', 'Members')}
        </Button>
      ) : null}
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          {/* Cancel is the way out, so the primitive's own close, named in
              English alone, is not drawn beside it. */}
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t('backoffice.rename', 'Rename')}</DialogTitle>
              <DialogDescription>{t('backoffice.renameAbout', 'The new name and slug take the place of the old ones for everyone in this organization.')}</DialogDescription>
            </DialogHeader>
            <form noValidate onSubmit={(event) => void save(event)} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`organization-name-${id}`}>{t('organization.name', 'Name')}</Label>
                <Input id={`organization-name-${id}`} name="name" required aria-required dir="auto" defaultValue={String(row.name ?? '')} aria-invalid={wrong.name ? true : undefined} aria-describedby={wrong.name ? `organization-name-${id}-error` : undefined} />
                {wrong.name ? <p id={`organization-name-${id}-error`} role="alert" className="text-sm text-destructive">{wrong.name}</p> : null}
              </div>
              {others.map((one) => (
                <div key={one} className="grid gap-2">
                  <Label htmlFor={`organization-name-${one}-${id}`}>{(t('backoffice.nameIn', 'Name in {language}, if it has one') ?? '').replace('{language}', () => endonym(one))}</Label>
                  <Input id={`organization-name-${one}-${id}`} name={`name-${one}`} lang={one} dir="auto" defaultValue={nameIn({ name: '', names: row.names }, one)} />
                </div>
              ))}
              <div className="grid gap-2">
                <Label htmlFor={`organization-slug-${id}`}>{t('organization.slug', 'Slug')}</Label>
                <Input id={`organization-slug-${id}`} name="slug" required aria-required dir="ltr" pattern={slugShape.source.slice(1, -1)} defaultValue={String(value ?? '')} aria-invalid={wrong.slug ? true : undefined} aria-describedby={wrong.slug ? `organization-slug-${id}-error` : undefined} />
                {wrong.slug ? <p id={`organization-slug-${id}-error`} role="alert" className="text-sm text-destructive">{wrong.slug}</p> : null}
              </div>
              {refusal ? (
                <p role="alert" className="text-sm text-destructive">
                  {refusal}
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>{t('admin.cancel', 'Cancel')}</DialogClose>
                <Button type="submit">{t('admin.save', 'Save')}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
