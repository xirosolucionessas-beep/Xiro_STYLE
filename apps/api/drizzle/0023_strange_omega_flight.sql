CREATE TABLE "client_reset_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_reset_tokens" ADD CONSTRAINT "client_reset_tokens_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_reset_account_idx" ON "client_reset_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "client_reset_expires_idx" ON "client_reset_tokens" USING btree ("expires_at");