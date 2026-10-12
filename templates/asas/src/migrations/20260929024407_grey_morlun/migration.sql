-- Edited by hand from what `mithaq migrate` wrote, which added the two
-- constraints bare, so a table already holding a duplicate failed on Postgres's
-- own "could not create unique index" and named one pair. Each table is checked
-- first and the migration refused in words that say what to do, and nothing is
-- deleted: which of two roles of one name is the right one, and which of two
-- assignments to keep, is the tenant's call, never this file's. A null tenant
-- counts as one tenant, as the constraints do
-- (https://github.com/drhomet/mithaq/issues/158). The end state is the snapshot's.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "roles" GROUP BY "tenant_id", "name" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'roles holds two or more rows with one name in one tenant, and each of them grants its keys.'
      USING HINT = 'Find them with SELECT tenant_id, name, count(*) FROM roles GROUP BY tenant_id, name HAVING count(*) > 1; then delete or rename all but one of each, and run the migration again.';
  END IF;
  IF EXISTS (SELECT 1 FROM "member_roles" GROUP BY "tenant_id", "user_id", "role" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'member_roles assigns one role to one member more than once in one tenant.'
      USING HINT = 'Find them with SELECT tenant_id, user_id, role, count(*) FROM member_roles GROUP BY tenant_id, user_id, role HAVING count(*) > 1; then delete all but one of each, and run the migration again.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_tenant_id_user_id_role_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","user_id","role");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_name_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","name");
