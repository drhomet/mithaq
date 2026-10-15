import { createFileRoute } from '@tanstack/react-router'
import { documentHead } from '../copy.ts'
import { ChoosePassword, passwordGate, tokenSearch } from '../choose-password.tsx'

// Where a forgotten password's link lands. A first password, chosen from a sign-up's or an added person's link, has a
// page of its own, `/auth/set-password`, with the same form.
export const Route = createFileRoute('/auth/reset-password')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.resetPassword')),
  validateSearch: tokenSearch,
  beforeLoad: ({ search }: { search: { token?: string } }) => passwordGate(search),
  component: ResetPassword,
})

function ResetPassword() {
  return <ChoosePassword {...Route.useSearch()} {...Route.useRouteContext()} first={false} />
}
