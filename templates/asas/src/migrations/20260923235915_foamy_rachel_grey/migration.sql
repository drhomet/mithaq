ALTER TABLE "courses" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "level" numeric;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "notifications" boolean;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "delivery" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "access_code" varchar(6);--> statement-breakpoint
ALTER TABLE "course_sessions" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "course_sessions" ADD COLUMN "format" text;