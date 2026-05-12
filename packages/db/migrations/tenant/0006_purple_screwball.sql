CREATE INDEX "audit_log_actor_created" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_created" ON "audit_log" USING btree ("action_code","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_created" ON "audit_log" USING btree ("target_id","created_at");--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_locked_le_balance" CHECK ("wallets"."locked_balance" <= "wallets"."balance");