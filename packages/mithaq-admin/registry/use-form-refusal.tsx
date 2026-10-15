import { useEffect, useState } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'
import type { ClientKayan } from 'mithaq/admin'
import { labelFor, type Copy } from 'mithaq-admin/copy.ts'
import { issuesOf, refusalWords } from 'mithaq-admin/form-rules.tsx'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'

/**
 * The refusal a form holds, its own or the one the host caught: its key, the fields it names with each one's
 * sentence, the sentence over the form, and how a field drops its part once the person changes it.
 */
export const useFormRefusal = ({ copy, error, form, kayan }: { copy: Copy; error: unknown; form: AnyFormApi; kayan: ClientKayan }) => {
  const { t } = copy
  const [refused, setRefused] = useState<unknown>(undefined)
  const held = refused === undefined ? error : refused
  const shown = refusalKeyOf(held)
  const issues = issuesOf(held)
  // The wire message is itself a copy key; a key nothing answers is drawn as it arrived, which is what
  // a custom shape that writes none of our keys sends.
  const sentences: Record<string, string> = Object.create(null)
  for (const [name, issue] of Object.entries(issues)) sentences[name] = t(issue, issue) ?? issue
  // Only over fields: a refusal naming none is the toast's to say.
  const banner = shown && Object.keys(issues).length
    ? refusalWords({
        kayan: kayan.name,
        shown,
        labels: Object.keys(issues).flatMap((name) => {
          const field = kayan.fields.find((one) => one.name === name)
          return field ? [labelFor({ kayan, field, copy })] : []
        }),
        copy,
      })
    : undefined

  // Put the refusal where TanStack keeps a server's answer (`onServer`), so a project's own control reading
  // `field.state.meta.errors` sees the same sentence the shell draws.
  useEffect(() => {
    // The slot is typed off an `onServer` validator, which this form declares none of; TanStack
    // writes the key anyway, so the cast only bridges the types.
    form.setErrorMap({ onServer: { form: undefined, fields: sentences } } as Parameters<AnyFormApi['setErrorMap']>[0])
  }, [form, JSON.stringify(sentences)])

  // Once the refusal names no field it is `null`, not `undefined`, so the host's own refusal does not come back.
  const forget = (name: string) => {
    if (issues[name] === undefined) return
    const { data } = held as { data: { params: { issues: { path?: unknown }[] } } }
    const rest = data.params.issues.filter((issue) => String(issue.path).split('.')[0] !== name)
    setRefused(rest.length ? { ...(held as object), data: { ...data, params: { ...data.params, issues: rest } } } : null)
  }

  return { held, shown, issues, sentences, banner, setRefused, forget }
}
