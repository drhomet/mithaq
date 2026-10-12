CREATE TABLE "member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"tenant_id" text,
	"user_id" text NOT NULL,
	"role" varchar(60) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "is_system" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX "member_roles_created_at_index" ON "member_roles" ("created_at");--> statement-breakpoint
CREATE INDEX "member_roles_user_id_index" ON "member_roles" ("user_id");--> statement-breakpoint
CREATE INDEX "member_roles_role_index" ON "member_roles" ("role");--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;