import { courses } from './courses/courses.ts'
import { enrollments } from './enrollments/enrollments.ts'
import { media } from './media/media.ts'
import { sessions } from './sessions/sessions.ts'

export const kayan = [media, courses, sessions, enrollments] as const
