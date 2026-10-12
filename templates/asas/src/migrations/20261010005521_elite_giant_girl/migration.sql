-- Each fixed role's label from its code (templates/asas/src/roles.ts
-- `export const systemRoles`), on a row the access target seeded before it
-- wrote one, so the labels can be NOT NULL (https://github.com/drhomet/mithaq/issues/268).
-- A label a row already holds is kept.
UPDATE "roles" SET "label_ar" = coalesce("roles"."label_ar", "code"."ar"), "label_en" = coalesce("roles"."label_en", "code"."en")
FROM (VALUES
  ('super_admin', 'مدير المنصة', 'Platform administrator'),
  ('support', 'الدعم', 'Support'),
  ('explorer', 'مستكشف', 'Explorer'),
  ('administrator', 'مدير', 'Administrator'),
  ('registrar', 'مسجل', 'Registrar'),
  ('instructor', 'مدرس', 'Instructor'),
  ('student', 'طالب', 'Student')
) AS "code" ("name", "ar", "en")
WHERE "roles"."is_system" AND "roles"."tenant_id" IS NULL AND "roles"."name" = "code"."name"
  AND ("roles"."label_ar" IS NULL OR "roles"."label_en" IS NULL);--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "label_ar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "label_en" SET NOT NULL;