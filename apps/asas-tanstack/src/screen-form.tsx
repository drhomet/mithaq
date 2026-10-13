import { useBlocker, useRouter } from '@tanstack/react-router'
import { useState, type ReactElement } from 'react'
import { Form } from './components/mithaq/form.tsx'
import type { FormProps } from './components/mithaq/form-types.tsx'

/**
 * A kayan's form on a screen's page. A create moves to the new row's edit page, a delete to the list.
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
// mithaq-admin f355602d9b433b5ced670b49042fa08f689458b7 3a8bc845a9866b9145549a935dfebd311da1348d5f94984ef0c6a03264940d25
