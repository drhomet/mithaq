-- `changes` held each entry's JSON as text, from before the language had a json kind, and becomes
-- the jsonb it always held. A row whose text is no JSON would stop the cast below with Postgres'
-- own error and no word of which table: it is counted first, and the migration stops naming the
-- count, so a person decides each row and nothing is changed. Each row is cast on its own, since
-- Postgres 15, the oldest this project runs on, has no pg_input_is_valid.
-- ponytail: one subtransaction per row; a log of millions of entries is the ceiling, and one
-- `pg_input_is_valid("changes", 'jsonb')` count is the upgrade once Postgres 16 is the oldest.
DO $$
DECLARE
  entry record;
  unread bigint := 0;
BEGIN
  FOR entry IN SELECT "changes" FROM "audit_log" LOOP
    BEGIN
      PERFORM entry."changes"::jsonb;
    EXCEPTION WHEN others THEN
      unread := unread + 1;
    END;
  END LOOP;
  IF unread > 0 THEN
    RAISE EXCEPTION 'Table audit_log holds % row(s) whose changes is not JSON, which a jsonb column cannot hold. Correct or delete each one, then run the migration again. Nothing was changed.', unread;
  END IF;
END $$;--> statement-breakpoint
-- The names of the columns each entry changed, which are the keys `changes` holds: a search finds
-- one by the path `changes.<column>`, so nothing is lost with it.
ALTER TABLE "audit_log" DROP COLUMN "changed";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "changes" SET DATA TYPE jsonb USING "changes"::jsonb;
