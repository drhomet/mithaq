-- An enrollment now requires a session and a student (https://github.com/drhomet/mithaq/issues/227).
-- A row that names neither, or only one, cannot take the two NOT NULL constraints
-- below, and nothing here decides for the project what such a row was, so the
-- migration refuses and changes nothing until each is given a session and a
-- student or deleted deliberately. The rows are listed in
-- templates/asas/src/enrollments/README.md.
DO $$
DECLARE ownerless integer;
BEGIN
  SELECT count(*) INTO ownerless FROM "enrollments" WHERE "session_id" IS NULL OR "student_id" IS NULL;
  IF ownerless > 0 THEN
    RAISE EXCEPTION '% enrollment row(s) name no session or no student, withdrawn ones included. Give each a session and a student, or delete it deliberately, then migrate again.', ownerless;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "enrollments" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollments" ALTER COLUMN "student_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_session_id_course_sessions_id_fkey", ADD CONSTRAINT "enrollments_session_id_course_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "course_sessions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_student_id_user_id_fkey", ADD CONSTRAINT "enrollments_student_id_user_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT;