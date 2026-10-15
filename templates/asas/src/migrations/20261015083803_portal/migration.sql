ALTER TABLE "courses" ADD COLUMN "self_enroll" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "site_title";