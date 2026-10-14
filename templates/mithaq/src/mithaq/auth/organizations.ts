// How this project holds its people: how many organizations, and who may join. A module of its own,
// importing nothing, so a page reads it without loading the provider. `create-mithaq` writes it; a
// project changes it by hand, as the README's "Organization modes" says.

/**
 * How many organizations the project holds. In both modes a per-organization kayan places
 * `organization` and core scopes it, so a switch moves no row.
 *
 * - `'many'`: each sign-up founds its own organization.
 * - `'one'`: one organization, made on `/auth/first-run`.
 *
 * The tenant target reads it too: a start over more than one organization in `'one'` is refused.
 */
export const organizations: 'one' | 'many' = 'many'

/**
 * In `'one'`, whether a page names the organization. `false` says nothing of one: the first-run
 * asks no name, the Members page is Users and the sidebar shows the app's name. `'many'` takes
 * `true`: there a person switches between them by name.
 */
export const showOrganization: boolean = true

/**
 * In `'one'`, who may make an account. `'many'` takes `'open'` alone: there each
 * sign-up founds its own organization.
 *
 * - `'invite'`: only someone holding an invitation, signing up with the invitation's id and address.
 *   Every other sign-up is refused with one answer, which tells nobody whether an address has an
 *   account.
 * - `'open'`: anyone, who joins the organization as `joinRole` once their address is verified (or
 *   at once when `verifyEmail` is false). A production start refuses it without a mailer.
 */
export const signUp: 'invite' | 'open' = 'open'

/**
 * The business role an open joiner is given, a slug of `roles/tenant-roles.ts`, or `null` for none:
 * the person joins, reads nothing, and an administrator gives them a role on the Members page,
 * which is how a project approves each joiner. Without the roles add-on it is `null`, and a joiner
 * holds the provider's `member`. `'many'` takes `null`: nobody joins there but by invitation.
 */
export const joinRole: string | null = null

/**
 * Whether a new account proves its address by a mailed link before it signs in, read with an open
 * sign-up: in `'one'`, before it joins too. `'many'` takes `true`: anyone founds an organization
 * there, so a sign-up must tell nobody which addresses have an account.
 */
export const verifyEmail: boolean = true

/**
 * In `'one'` with an open sign-up and `verifyEmail`, the only address domains that may
 * sign up, lowercase ASCII (`xn--` for an international one): `example.com` is that domain alone, and
 * `*.example.com` every domain under it, never itself. Empty, any domain may.
 */
export const allowedDomains: readonly string[] = []
