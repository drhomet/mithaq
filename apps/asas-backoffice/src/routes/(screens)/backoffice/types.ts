// Written by `mithaq generate screens`. Do not edit.
import type { ScreenClient as Client } from 'mithaq/admin'
export type { PageClient } from 'mithaq/admin'
export type UserValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: string | null
  banned: boolean | null
  banReason: string | null
  banExpires: Date | null
}
export type OrganizationValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  name: string
  slug: string
  logo: string | null
  metadata: string | null
  names: string | null
}
export type MemberValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organizationId: string
  userId: string
  role: string
}
export type CoursesValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  title: string
  summary: string | null
  fee: number | null
  currency: 'SAR' | 'USD' | null
  level: number | null
  notifications: boolean | null
  delivery: 'live' | 'recorded' | null
  audience: 'beginner' | 'advanced' | null
  accessCode: string | null
  archived: boolean | null
  topics: string[] | null
  opensOn: string | null
  archiveReason: string | null
  tags: string[] | null
  scheduledSessions: Values['sessions'][]
  _status: 'draft' | 'published' | null
  details: { root: Record<string, unknown> } | null
  cover: unknown
}
export type SessionsValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  course: string
  startsAt: Date
  capacity: number | null
  venue: 'online' | 'campus' | null
  format: 'workshop' | 'lecture' | null
  archived: boolean | null
  details: { root: Record<string, unknown> } | null
  enrollments: Values['enrollments'][]
  archiveReason: string | null
}
export type EnrollmentsValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  session: string
  student: string
  deletedAt: Date | null
}
export type TagsValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  name: Record<'ar' | 'en', string>
}
export type RolesValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  name: string
  label: Record<'ar' | 'en', string>
  permissions: string[]
}
export type MemberRolesValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  user: string
  role: string
}
export type LocalUsersValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  email: string
  hash: string
  salt: string
  sessions: string | null
  loginAttempts: number | null
  lockUntil: Date | null
  resetPasswordToken: string | null
  resetPasswordAttempts: number | null
  resetPasswordExpiration: Date | null
  _verified: boolean | null
  _verificationToken: string | null
}
export type Values = {
  user: UserValues
  organization: OrganizationValues
  member: MemberValues
  courses: CoursesValues
  sessions: SessionsValues
  enrollments: EnrollmentsValues
  tags: TagsValues
  roles: RolesValues
  memberRoles: MemberRolesValues
  localUsers: LocalUsersValues
}
export type Pages = {
  user: 'list' | 'view'
  organization: 'list' | 'view'
  member: 'list' | 'view'
  courses: 'list' | 'view'
  sessions: 'list' | 'view'
  enrollments: 'list' | 'view'
  tags: 'list' | 'view'
  roles: 'list' | 'view'
  memberRoles: 'list' | 'view'
  localUsers: 'list' | 'edit'
}
export type ScreenClient = Client<Pages>
