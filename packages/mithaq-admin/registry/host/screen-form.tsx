import { useBlocker, useRouter } from '@tanstack/react-router'
import { useState, type ReactElement } from 'react'
import { Form } from 'mithaq-admin/form.tsx'
import type { FormProps } from 'mithaq-admin/form-types.tsx'

/**
 * A kayan's form on a screen's page. A create moves to where `edit` sends it, the new row's edit page or, for a page
 * opened over its list, the list; a delete moves to the list.
 * While the form holds a change the router blocks navigation and the form asks its discard question.
 */
export function ScreenForm({ edit, list, ...props }: Omit<FormProps, 'onDone' | 'onDirty' | 'onCancel' | 'blocked'> & {
  /** The href of a row's edit page, or nothing where the kayan has none. */
  edit: (id: string) => string | undefined
  /** The href of the kayan's list, or nothing where it has none. */
  list?: string
}): ReactElement {
  const router = useRouter()
  const [dirty, setDirty] = useState(false)
  const blocker = useBlocker({ shouldBlockFn: () => dirty, withResolver: true, enableBeforeUnload: false })
  // `ignoreBlocker`: the form reports clean only on the render after the save.
  const go = (href: string | undefined) => void (href ? router.navigate({ href, ignoreBlocker: true }) : router.invalidate())
  const landing = (row: unknown, effect?: string) => {
    const id = (row as { id?: unknown } | null | undefined)?.id
    return effect === 'delete' ? list : effect === 'create' && id !== undefined ? edit(String(id)) : undefined
  }
  return (
    <Form
      {...props}
      onDirty={setDirty}
      onDone={(row, effect) => go(landing(row, effect))}
      onCancel={list ? () => go(list) : undefined}
      blocked={blocker.status === 'blocked' ? blocker : undefined}
    />
  )
}
