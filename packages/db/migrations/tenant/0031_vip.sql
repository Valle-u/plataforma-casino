-- Sprint 52.3 — VIP tier system server-side.
--
-- Tablas:
--   vip_tiers — catálogo de tiers (def thresholds + perks aplicables).
--   user_vip_status — fila por user con tier actual + snapshot volume30d.
--
-- VipService aplica los perks reales (deposit bonus, cashback) consultando
-- estas tablas. Lo que ve el cliente (perks display) se infiere del
-- mismo catálogo.

-- ── vip_tiers ────────────────────────────────────────────────────────
CREATE TABLE "vip_tiers" (
  "id" uuid PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "color" text NOT NULL DEFAULT '#CD7F32',
  "threshold_chips" numeric(20, 2) NOT NULL DEFAULT '0',
  "deposit_bonus_pct" numeric(5, 2) NOT NULL DEFAULT '0',
  "cashback_pct" numeric(5, 2) NOT NULL DEFAULT '0',
  "perks_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "vip_tiers_code_unique" UNIQUE ("code")
);

CREATE INDEX "vip_tiers_threshold" ON "vip_tiers" ("threshold_chips");

-- ── user_vip_status ──────────────────────────────────────────────────
CREATE TABLE "user_vip_status" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "current_tier_code" text NOT NULL DEFAULT 'bronze',
  "volume_30d" numeric(20, 2) NOT NULL DEFAULT '0',
  "recomputed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- ── Seed 4 tiers default ─────────────────────────────────────────────
-- Thresholds en chips. depositBonusPct + cashbackPct conservadores —
-- admin puede subir/bajar via UPDATE manual.

INSERT INTO "vip_tiers" (
  "id", "code", "label", "color",
  "threshold_chips", "deposit_bonus_pct", "cashback_pct",
  "perks_json", "sort_order"
) VALUES
  (gen_random_uuid(), 'bronze', 'Bronce', '#CD7F32',
    '0', '0', '0',
    '{"perks": ["Acceso a juegos", "Ruleta diaria", "Racha de login"]}'::jsonb,
    10),

  (gen_random_uuid(), 'silver', 'Plata', '#C0C0C0',
    '10000', '10', '0',
    '{"perks": ["+10% bonus en depósitos", "Retiros más rápidos", "Acceso a juegos", "Ruleta diaria", "Racha de login"]}'::jsonb,
    20),

  (gen_random_uuid(), 'gold', 'Oro', '#FFD700',
    '100000', '20', '3',
    '{"perks": ["+20% bonus en depósitos", "Cashback semanal 3%", "Spin extra diario en la rueda", "Soporte prioritario", "Retiros más rápidos"], "support_priority": true}'::jsonb,
    30),

  (gen_random_uuid(), 'platinum', 'Platino', '#E5E4E2',
    '500000', '30', '5',
    '{"perks": ["+30% bonus en depósitos", "Cashback semanal 5%", "Promociones exclusivas", "Account manager dedicado"], "support_priority": true, "exclusive_promos": true, "account_manager": true}'::jsonb,
    40);
