CREATE INDEX "account_user_id_index" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_index" ON "invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_index" ON "invitation" ("email");--> statement-breakpoint
CREATE INDEX "member_organization_id_index" ON "member" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_index" ON "member" ("user_id");--> statement-breakpoint
CREATE INDEX "organization_role_organization_id_index" ON "organization_role" ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_role_role_index" ON "organization_role" ("role");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_index" ON "verification" ("identifier");