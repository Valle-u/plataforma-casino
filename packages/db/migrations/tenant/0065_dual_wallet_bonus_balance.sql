-- Dual Wallet: bonus_balance integration (Fase 2)
-- Adds bonus_balance to wallets, bonus_balance_after to wallet_transactions,
-- and new tx types bonus_credit/bonus_debit to wallet_tx_type enum.

-- 1. Add bonus_credit and bonus_debit to wallet_tx_type enum
ALTER TYPE "public"."wallet_tx_type" ADD VALUE IF NOT EXISTS 'bonus_credit';
ALTER TYPE "public"."wallet_tx_type" ADD VALUE IF NOT EXISTS 'bonus_debit';

-- 2. Add bonus_balance column to wallets
ALTER TABLE "wallets" ADD COLUMN "bonus_balance" numeric(20, 2) DEFAULT '0' NOT NULL;

-- 3. Add CHECK constraint for bonus_balance >= 0
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_bonus_balance_nonneg" CHECK ("bonus_balance" >= 0);

-- 4. Add bonus_balance_after column to wallet_transactions
ALTER TABLE "wallet_transactions" ADD COLUMN "bonus_balance_after" numeric(20, 2) DEFAULT '0' NOT NULL;
