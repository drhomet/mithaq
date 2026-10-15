import { createFileRoute } from '@tanstack/react-router'
import { documentHead } from '../copy.ts'
import { ChoosePassword, passwordGate, tokenSearch } from '../choose-password.tsx'

// Where a sign-up's or an added person's link lands: a brand-new account chooses its first password here, under a
// title that says so, and never reads that it is resetting one.
export const Route = createFileRoute('/auth/set-password')({
  head: ({ match }) => documentHead(match.context, (t) => t('auth.setPassword')),
  validateSearch: tokenSearch,
  beforeLoad: ({ search }: { search: { token?: string } }) => passwordGate(search),
  component: SetPassword,
})

function SetPassword() {
  return <ChoosePassword {...Route.useSearch()} {...Route.useRouteContext()} first />
}
