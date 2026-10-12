-- Edited by hand from what `mithaq migrate` wrote, which added the two label
-- columns bare. A custom role written before labels reads by its slug, so its
-- label is backfilled with the slug in both locales; a fixed role's label is its
-- code's whatever its row holds (`templates/asas/src/roles/roles.ts`
-- `const labelled`), and the columns stay nullable because the access target
-- seeds a fixed role with no label (https://github.com/drhomet/mithaq/issues/163).
ALTER TABLE "roles" ADD COLUMN "label_ar" varchar(60);--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "label_en" varchar(60);--> statement-breakpoint
UPDATE "roles" SET "label_ar" = "name", "label_en" = "name";--> statement-breakpoint
-- An assignment whose role is gone, left by a role deleted before a held role
-- was refused its delete. It grants nothing today and would grant the keys of
-- any later role of the same name in its tenant, so it is removed rather than
-- left armed. A fixed role's row carries no tenant and is every tenant's, and
-- the tenant's fixed roles as the code named them when this was written are
-- kept by name too, so a database whose fixed rows were never seeded loses no
-- administrator (`templates/asas/src/roles.ts` `export const tenantRoles`).
DELETE FROM "member_roles" WHERE "role" NOT IN ('administrator', 'registrar', 'instructor') AND NOT EXISTS (
  SELECT 1 FROM "roles"
  WHERE "roles"."name" = "member_roles"."role"
    AND ("roles"."tenant_id" = "member_roles"."tenant_id" OR "roles"."tenant_id" IS NULL)
);
