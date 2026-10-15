CREATE TABLE "backoffice_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"action" text NOT NULL,
	"actor" text,
	"actor_email" text,
	"target" text,
	"target_email" text,
	"previous_role" text,
	"role" text,
	"reason" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "changed" text;--> statement-breakpoint
CREATE INDEX "backoffice_log_created_at_index" ON "backoffice_log" ("created_at");