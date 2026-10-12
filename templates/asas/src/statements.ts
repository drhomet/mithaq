/**
 * The keys this project adds beside a kayan's own operations, by kayan. Each
 * joins the catalog as `<kayan>.<key>`, held by a role like any operation's key,
 * and the dashboard's role form offers it among that kayan's operations,
 * labelled by the kayan's copy under `operations.<key>`. It is plain data,
 * imported by the server and by the role form alike.
 *
 * `enrollments.others` reaches every seat of the organization rather than the
 * actor's own.
 */
export const projectStatements = { enrollments: ['others'] } as const satisfies Record<string, readonly string[]>
