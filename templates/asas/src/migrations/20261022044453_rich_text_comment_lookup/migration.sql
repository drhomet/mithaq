DROP INDEX "rich_text_threads_organization_id_index";--> statement-breakpoint
DROP INDEX "rich_text_threads_record_kayan_index";--> statement-breakpoint
DROP INDEX "rich_text_threads_record_id_index";--> statement-breakpoint
DROP INDEX "rich_text_threads_created_at_index";--> statement-breakpoint
CREATE INDEX "rich_text_threads_record_field_created_idx" ON "rich_text_threads" ("organization_id","record_kayan","record_id","field","created_at");