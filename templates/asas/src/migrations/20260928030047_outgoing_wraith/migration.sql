CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"tenant_id" text,
	"kayan" varchar(60) NOT NULL,
	"record" text NOT NULL,
	"operation" varchar(60) NOT NULL,
	"actor" text,
	"impersonated_by" text,
	"changes" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_index" ON "audit_log" ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_record_index" ON "audit_log" ("record");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE SET NULL;