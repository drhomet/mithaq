CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"tenant_id" text,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"filesize" numeric NOT NULL,
	"width" numeric,
	"height" numeric,
	"key" text NOT NULL UNIQUE,
	"storage" text NOT NULL,
	"alt_ar" varchar(300) NOT NULL,
	"alt_en" varchar(300) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "cover_id" uuid;--> statement-breakpoint
CREATE INDEX "media_created_at_index" ON "media" ("created_at");--> statement-breakpoint
CREATE INDEX "media_filename_index" ON "media" ("filename");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_cover_id_media_id_fkey" FOREIGN KEY ("cover_id") REFERENCES "media"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE SET NULL;