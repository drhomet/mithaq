CREATE TABLE "mithaq_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"task" text NOT NULL,
	"input" jsonb,
	"queue" text NOT NULL,
	"tenant" text,
	"scheduled_for" timestamp(3) with time zone,
	"wait_until" timestamp(3) with time zone,
	"processing_until" timestamp(3) with time zone,
	"processing_token" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp(3) with time zone,
	"has_error" boolean DEFAULT false NOT NULL,
	"error" jsonb,
	"output" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mithaq_jobs_task_scheduled_for_unique" ON "mithaq_jobs" ("task","scheduled_for") WHERE "scheduled_for" is not null;--> statement-breakpoint
CREATE INDEX "mithaq_jobs_claim" ON "mithaq_jobs" ("queue","wait_until","created_at") WHERE "completed_at" is null and not "has_error";