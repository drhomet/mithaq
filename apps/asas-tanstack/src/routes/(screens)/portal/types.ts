// Written by `mithaq generate screens`. Do not edit.
import type { ScreenClient as Client } from 'mithaq/admin'
export type { PageClient } from 'mithaq/admin'
export type CoursesValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: unknown
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
  tags: unknown[] | null
  scheduledSessions: Values['sessions'][]
  _status: 'draft' | 'published' | null
  details: { root: Record<string, unknown> } | null
  cover: string | null
}
export type EnrollmentsValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: unknown
  session: string
  student: string
  deletedAt: Date | null
}
export type SessionsValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: unknown
  course: string
  startsAt: Date
  capacity: number | null
  venue: 'online' | 'campus' | null
  format: 'workshop' | 'lecture' | null
  archived: boolean | null
  details: { root: Record<string, unknown> } | null
  enrollments: Values['enrollments'][]
}
export type MediaValues = {
  id: string
  updatedAt: Date
  createdAt: Date
  organization: unknown
  filename: string
  mimeType: string
  filesize: number
  width: number | null
  height: number | null
  key: string
  storage: string
  alt: Record<'ar' | 'en', string>
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
export type Values = {
  courses: CoursesValues
  enrollments: EnrollmentsValues
  sessions: SessionsValues
  media: MediaValues
  user: UserValues
}
export type Pages = {
  courses: 'list' | 'edit'
  enrollments: 'list' | 'create' | 'edit'
  sessions: never
  media: never
  user: never
}
export type ScreenClient = Client<Pages>
