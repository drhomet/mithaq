ALTER TABLE "audit_log" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "courses" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "enrollments" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "media" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "member_roles" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "roles" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "course_sessions" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "settings" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "tags" RENAME COLUMN "tenant_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "member_roles" DROP CONSTRAINT "member_roles_tenant_id_user_id_role_unique";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_tenant_id_name_unique";--> statement-breakpoint
-- The shipped roles are code now and never a row: their rows, the only ones with no organization, go.
-- An assignment names a role by its slug, so every assignment of one keeps working.
DELETE FROM "roles" WHERE "is_system" = true;--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "is_system";--> statement-breakpoint
-- A row with no organization belongs to no tenant, and NOT NULL would refuse it: the migration
-- names its table and stops, so a person decides each row and nothing is deleted here.
DO $$
DECLARE
  name text;
  unowned bigint;
BEGIN
  FOREACH name IN ARRAY ARRAY['audit_log', 'courses', 'course_sessions', 'enrollments', 'media', 'member_roles', 'roles', 'settings', 'tags'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE organization_id IS NULL', name) INTO unowned;
    IF unowned > 0 THEN
      RAISE EXCEPTION 'Table % holds % row(s) with no organization_id, which belong to no organization. Assign each one an organization or delete it, then run the migration again. Nothing was changed.', name, unowned;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollments" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member_roles" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "course_sessions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_organization_id_index" ON "audit_log" ("organization_id");--> statement-breakpoint
CREATE INDEX "courses_organization_id_index" ON "courses" ("organization_id");--> statement-breakpoint
CREATE INDEX "enrollments_organization_id_index" ON "enrollments" ("organization_id");--> statement-breakpoint
CREATE INDEX "media_organization_id_index" ON "media" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_roles_organization_id_index" ON "member_roles" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_roles_organization_id_user_id_role_idx" ON "member_roles" ("organization_id","user_id","role");--> statement-breakpoint
CREATE INDEX "roles_organization_id_index" ON "roles" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_organization_id_name_idx" ON "roles" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "course_sessions_organization_id_index" ON "course_sessions" ("organization_id");--> statement-breakpoint
CREATE INDEX "settings_organization_id_index" ON "settings" ("organization_id");--> statement-breakpoint
CREATE INDEX "tags_organization_id_index" ON "tags" ("organization_id");