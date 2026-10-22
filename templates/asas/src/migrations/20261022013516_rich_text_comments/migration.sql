CREATE TABLE "rich_text_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"record_kayan" varchar(100) NOT NULL,
	"record_id" varchar(255) NOT NULL,
	"field" varchar(100) NOT NULL,
	"quote" varchar(4000) NOT NULL,
	"resolved" boolean NOT NULL,
	"comments" jsonb NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rich_text_threads_organization_id_index" ON "rich_text_threads" ("organization_id");--> statement-breakpoint
CREATE INDEX "rich_text_threads_record_kayan_index" ON "rich_text_threads" ("record_kayan");--> statement-breakpoint
CREATE INDEX "rich_text_threads_record_id_index" ON "rich_text_threads" ("record_id");--> statement-breakpoint
CREATE INDEX "rich_text_threads_created_at_index" ON "rich_text_threads" ("created_at");--> statement-breakpoint
ALTER TABLE "rich_text_threads" ADD CONSTRAINT "rich_text_threads_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT;