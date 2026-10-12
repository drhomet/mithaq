-- Edited by hand from what `mithaq migrate` wrote, which added "_status" with
-- its default of 'draft' and so turned every course already stored into a
-- draft no plain read returns. The column starts empty, every row already
-- there is published, and only then is the default set, so a course made
-- after this migration starts as a draft the way the field declares
-- (https://github.com/drhomet/mithaq/issues/132). The column stays nullable,
-- as every column a caller writes of a kayan that keeps drafts is, and a row
-- holding no status is read by no plain read. The four course columns that
-- were varchar become text, since a draft keeps no length; the change widens
-- them and loses no data. The end state is the snapshot's.
CREATE TABLE "_courses_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" uuid NOT NULL,
	"version" jsonb NOT NULL,
	"latest" boolean DEFAULT false NOT NULL,
	"autosave" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "_status" text;--> statement-breakpoint
UPDATE "courses" SET "_status" = 'published';--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "_status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "title" SET DATA TYPE text USING "title"::text;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "summary" SET DATA TYPE text USING "summary"::text;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "access_code" SET DATA TYPE text USING "access_code"::text;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "archive_reason" SET DATA TYPE text USING "archive_reason"::text;--> statement-breakpoint
CREATE INDEX "_courses_versions_parent_id_index" ON "_courses_versions" ("parent_id");--> statement-breakpoint
CREATE INDEX "_courses_versions_latest_index" ON "_courses_versions" ("latest");--> statement-breakpoint
CREATE INDEX "courses__status_index" ON "courses" ("_status");--> statement-breakpoint
ALTER TABLE "_courses_versions" ADD CONSTRAINT "_courses_versions_parent_id_courses_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "courses"("id") ON DELETE CASCADE;