import { courses } from './courses/courses.ts'
import { enrollments } from './enrollments/enrollments.ts'
import { sessions } from './sessions/sessions.ts'

export const kayan = [courses, sessions, enrollments] as const

// The images a course's reader reads as its cover, which the asas hands the media feature.
export { coverReads } from './courses/cover-reads.ts'
