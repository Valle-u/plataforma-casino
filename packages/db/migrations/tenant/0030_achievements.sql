-- Sprint 52.2 — achievements system server-side.
--
-- Crea catálogo de achievements (achievement_definitions) + tracking
-- de unlocks por user (user_achievements) + seed inicial con 16 logros
-- (matchea el catálogo que vivía client-side en Sprint 51.32).
--
-- Cuando un user desbloquea uno, el AchievementsService inserta una fila
-- en user_achievements + si rewardChips > 0 mintea esos chips a la
-- wallet del user (vía PromotionPrizeAwarder, mismo flow que premios
-- de promotions).

-- ── Enum de categoría ────────────────────────────────────────────────
CREATE TYPE "achievement_category" AS ENUM ('daily', 'weekly', 'milestone', 'vip');

-- ── Tabla achievement_definitions ────────────────────────────────────
CREATE TABLE "achievement_definitions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "description" text NOT NULL,
  "icon_name" text NOT NULL DEFAULT 'Trophy',
  "color" text NOT NULL DEFAULT '#FFD700',
  "category" "achievement_category" NOT NULL,
  "reward_chips" numeric(20, 2) NOT NULL DEFAULT '0',
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "achievement_definitions_code_unique" UNIQUE ("code")
);

CREATE INDEX "achievement_definitions_category_sort"
  ON "achievement_definitions" ("category", "sort_order");

-- ── Tabla user_achievements ──────────────────────────────────────────
CREATE TABLE "user_achievements" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "achievement_code" text NOT NULL,
  "unlocked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reward_wallet_tx_id" uuid REFERENCES "wallet_transactions"("id"),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX "user_achievements_user_code_unique"
  ON "user_achievements" ("user_id", "achievement_code");

CREATE INDEX "user_achievements_user_unlocked"
  ON "user_achievements" ("user_id", "unlocked_at");

-- ── Seed inicial — 16 achievements ───────────────────────────────────
-- Si admin después quiere editarlos/agregar, UPDATE/INSERT manual.
-- Los `code` deben matchear con los predicates del service.
-- `reward_chips` aspiracional — admin puede subirlos en producción.

INSERT INTO "achievement_definitions" (
  "id", "code", "label", "description", "icon_name", "color",
  "category", "reward_chips", "sort_order"
) VALUES
  -- Milestones (hitos lifetime)
  (gen_random_uuid(), 'first_bet', 'Primera tirada',
    'Hiciste tu primera apuesta. ¡Bienvenido al juego!',
    'Dice5', '#f87171', 'milestone', '50', 10),
  (gen_random_uuid(), 'first_win', 'Primera victoria',
    'Ganaste tu primer premio. Empezamos bien.',
    'Trophy', '#FFD700', 'milestone', '100', 20),
  (gen_random_uuid(), 'first_deposit', 'Primer depósito',
    'Cargaste fichas por primera vez.',
    'Coins', '#22c55e', 'milestone', '200', 30),
  (gen_random_uuid(), 'first_bonus', 'Primer bonus',
    'Tenés tu primer bonus en cuenta.',
    'Gift', '#FFD700', 'milestone', '0', 40),

  -- Volume (escalan según monto apostado lifetime)
  (gen_random_uuid(), 'volume_1k', 'Apostador casual',
    'Apostaste 1.000 chips en total.',
    'Target', '#4F9BFF', 'milestone', '100', 50),
  (gen_random_uuid(), 'volume_10k', 'Apostador serio',
    'Apostaste 10.000 chips. El ritmo está ahí.',
    'Target', '#FFD700', 'milestone', '500', 60),
  (gen_random_uuid(), 'volume_100k', 'High roller',
    'Cruzaste los 100.000 apostados. Top tier.',
    'Star', '#FFD700', 'milestone', '2000', 70),

  -- Daily
  (gen_random_uuid(), 'wheel_spin_today', 'Girá la rueda',
    'Giraste la ruleta diaria hoy.',
    'Sparkles', '#FFD700', 'daily', '0', 10),
  (gen_random_uuid(), 'streak_3', 'En fuego',
    'Conseguiste 3 días seguidos de racha.',
    'Flame', '#FF6B35', 'daily', '200', 20),

  -- Weekly
  (gen_random_uuid(), 'streak_7', 'Semana completa',
    'Reclamaste 7 días seguidos. Compromiso top.',
    'Flame', '#FF6B35', 'weekly', '1000', 10),
  (gen_random_uuid(), 'league_top_10', 'Top 10 de la liga',
    'Llegaste al top 10 de la liga activa.',
    'Medal', '#C0C0C0', 'weekly', '500', 20),
  (gen_random_uuid(), 'league_top_3', 'Podio',
    'Subiste al podio de la liga.',
    'Trophy', '#FFD700', 'weekly', '2000', 30),

  -- VIP
  (gen_random_uuid(), 'vip_silver', 'VIP Plata',
    'Alcanzaste el nivel Plata.',
    'Award', '#C0C0C0', 'vip', '500', 10),
  (gen_random_uuid(), 'vip_gold', 'VIP Oro',
    'Alcanzaste el nivel Oro.',
    'Crown', '#FFD700', 'vip', '2000', 20),
  (gen_random_uuid(), 'vip_platinum', 'VIP Platino',
    'Llegaste al tier más alto. Leyenda.',
    'Zap', '#E5E4E2', 'vip', '10000', 30);
