-- Edited by hand from what `mithaq migrate` wrote, which added name_ar NOT NULL
-- and so failed on any tags table holding rows. The column starts as a copy of
-- the English and is made NOT NULL once every row holds one
-- (https://github.com/drhomet/mithaq/issues/144). The end state is the snapshot's.
ALTER TABLE "tags" RENAME COLUMN "name" TO "name_en";--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "name_ar" varchar(60);--> statement-breakpoint
UPDATE "tags" SET "name_ar" = "name_en";--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "name_ar" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "tags_name_ar_index" ON "tags" ("name_ar");
