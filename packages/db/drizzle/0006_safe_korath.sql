CREATE TABLE "custom_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"document_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_token" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"provision_mode" text DEFAULT 'manual' NOT NULL,
	"custom_hostname_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_domains_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "domain_routes" (
	"hostname" text PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;