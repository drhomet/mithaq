/**
 * The keys this project adds beside a kayan's own operations, by kayan. Each
 * joins the catalog as `<kayan>.<key>`, held by a role like any operation's key,
 * and the dashboard's role form offers it among that kayan's operations,
 * labelled by the kayan's copy under `operations.<key>`. It is plain data,
 * imported by the server and by the role form alike.
 */
export const projectStatements = {
  // add-on: courses
  // Every seat of the organization rather than the actor's own.
  enrollments: ['others'],
  // end add-on: courses
} as const satisfies Record<string, readonly string[]>
