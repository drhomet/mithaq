-- A database whose courses_tags holds two rows for one (parent_id, order),
-- which the primary key below would stop on, is refused with a count before
-- any statement here runs (https://github.com/drhomet/mithaq/issues/254).
DO $$ DECLARE shared integer; BEGIN
  SELECT coalesce(sum(held), 0) INTO shared FROM (SELECT count(*) AS held FROM "courses_tags" GROUP BY "parent_id", "order" HAVING count(*) > 1) AS pairs;
  IF shared > 0 THEN
    RAISE EXCEPTION 'courses_tags holds % rows whose (parent_id, order) another row also holds, and the primary key would stop on them. Delete or renumber each one, and apply again.', shared;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "courses_tags" ADD CONSTRAINT "courses_tags_pkey" PRIMARY KEY("parent_id","order");--> statement-breakpoint
CREATE INDEX "courses_tags_target_id_index" ON "courses_tags" ("target_id");