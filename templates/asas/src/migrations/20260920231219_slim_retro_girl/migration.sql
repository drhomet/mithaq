CREATE TABLE "courses_tags" (
	"parent_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(60) NOT NULL,
	"tenant_id" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "courses_tags_parent_id_index" ON "courses_tags" ("parent_id");--> statement-breakpoint
CREATE INDEX "tags_name_index" ON "tags" ("name");--> statement-breakpoint
CREATE INDEX "tags_created_at_index" ON "tags" ("created_at");--> statement-breakpoint
ALTER TABLE "courses_tags" ADD CONSTRAINT "courses_tags_parent_id_courses_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "courses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "courses_tags" ADD CONSTRAINT "courses_tags_target_id_tags_id_fkey" FOREIGN KEY ("target_id") REFERENCES "tags"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE SET NULL;