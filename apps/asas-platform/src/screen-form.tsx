import { useBlocker, useRouter } from '@tanstack/react-router'
import { useState, type ReactElement } from 'react'
import { Form, type FormProps } from './components/mithaq/form.tsx'

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
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 7284b5e97770fd0c395fafa0b7459cab4ceb458e4bc982dc8233894126116170
