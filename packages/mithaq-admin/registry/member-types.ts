/** Authorized provider-backed memberships and tenant role definitions, never shared user rows. */
export type Member = { userId: string; name: string; email: string; joined: string; lastSeen?: string; owner: boolean; roles: { id: string; role: string }[] }
export type Role = { name: string; label?: Readonly<Record<string, string>>; fixed: boolean; permissions?: readonly string[] }
