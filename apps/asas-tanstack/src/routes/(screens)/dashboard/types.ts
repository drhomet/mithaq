// Written by `mithaq generate screens`. Do not edit.
import type { ScreenClient as Client } from 'mithaq/admin'
export type { PageClient } from 'mithaq/admin'
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
  cover: string | null
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
export type MediaValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  filename: string
  mimeType: string
  filesize: number
  width: number | null
  height: number | null
  key: string
  storage: string
  alt: Record<'ar' | 'en', string>
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
export type SettingsValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: string
  siteTitle: string
  maintenance: boolean | null
  contactEmail: string | null
  globalType: string
}
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
export type AuditLogValues = {
  id: string
  createdAt: Date
  organization: string
  kayan: string
  record: string
  operation: string
  actor: string | null
  impersonatedBy: string | null
  changes: string
}
export type Values = {
  courses: CoursesValues
  sessions: SessionsValues
  enrollments: EnrollmentsValues
  tags: TagsValues
  media: MediaValues
  roles: RolesValues
  memberRoles: MemberRolesValues
  settings: SettingsValues
  user: UserValues
  organization: OrganizationValues
  auditLog: AuditLogValues
}
export type Pages = {
  courses: 'list' | 'create' | 'edit' | 'board'
  sessions: 'list' | 'create' | 'edit'
  enrollments: 'list' | 'create' | 'edit'
  tags: 'list' | 'create' | 'edit'
  media: 'list' | 'create' | 'edit'
  roles: 'list' | 'create' | 'edit'
  memberRoles: never
  settings: 'settings'
  user: never
  organization: never
  auditLog: never
}
export type ScreenClient = Client<Pages>
