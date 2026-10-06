CREATE TABLE "client_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"photo_file" text,
	"language" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"temp_password_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "client_accounts_id_business_uq" UNIQUE("id","business_id")
);
--> statement-breakpoint
CREATE TABLE "client_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"account_id" uuid,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"channel" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_recovery_codes_channel_ck" CHECK ("client_recovery_codes"."channel" in ('sms','whatsapp','email'))
);
--> statement-breakpoint
CREATE TABLE "client_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_label" text DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "client_account_id" uuid;--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_client_business_fk" FOREIGN KEY ("client_id","business_id") REFERENCES "public"."clients"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_audit_log" ADD CONSTRAINT "client_audit_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_audit_log" ADD CONSTRAINT "client_audit_log_actor_fk" FOREIGN KEY ("actor_user_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_recovery_codes" ADD CONSTRAINT "client_recovery_codes_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sessions" ADD CONSTRAINT "client_sessions_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_accounts_business_phone_uq" ON "client_accounts" USING btree ("business_id","phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "client_accounts_client_uq" ON "client_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_audit_log_business_idx" ON "client_audit_log" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "client_recovery_codes_account_idx" ON "client_recovery_codes" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_sessions_token_uq" ON "client_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_sessions_account_idx" ON "client_sessions" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_account_business_fk" FOREIGN KEY ("client_account_id","business_id") REFERENCES "public"."client_accounts"("id","business_id") ON DELETE set null ON UPDATE no action;