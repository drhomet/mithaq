// How this project holds its people: how many organizations, and who may join. A module of its own,
// importing nothing, so a page reads it without loading the provider. `create-mithaq` writes it; a
// project changes it by hand, as the README's "Organization modes" says.

/**
 * How many organizations the project holds. In every mode a per-organization kayan places
 * `organization` and core scopes it, so a switch moves no row.
 *
 * - `'many'`: each sign-up founds its own organization.
 * - `'one'`: one organization, named, made on `/auth/first-run`.
 * - `'none'`: one organization, never shown, made on `/auth/first-run`.
 *
 * The tenant target reads it too: a start over more than one organization in `'one'` or `'none'` is
 * refused.
 */
export const organizations: 'none' | 'one' | 'many' = 'many'
