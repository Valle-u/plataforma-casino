-- 0103 · Historial de flips dep<->indep de socios (branch_flip_events).
-- (fix del double-dip de comisión, decisión del dueño 2026-08-25)
--
-- Problema: el motor de comisiones ventaneaba el tramo dependiente de un socio
-- con solo 2 timestamps (users.commission_eligible_from/until), que representan
-- el tramo ACTUAL, no la historia. Un flip posterior los sobreescribe y borra
-- el boundary de un flip anterior. Un recompute del mes viejo dejaba de
-- ventanear -> el socio cobraba comision dependiente por el mes ENTERO,
-- incluido el tramo que ya gano como independiente (double-dip). Bug espejo:
-- un socio hoy independiente, al recomputar un mes en que fue dependiente,
-- cobraba CERO (subtree excluido por el flag ACTUAL).
--
-- Fix: tabla append-only con una fila por flip REAL. `mode` = modo NUEVO
-- vigente TRAS el flip (a partir de `at`). El windowing reconstruye los tramos
-- reales del periodo desde este historial, sin depender del flag actual.
-- Aditiva: no toca ninguna tabla ni dato existente. Los socios sin events
-- (estado pre-migracion) caen al windowing legacy por from/until.
CREATE TABLE IF NOT EXISTS branch_flip_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode text NOT NULL,
  at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_flip_events_mode_valid CHECK (mode IN ('independent', 'dependent'))
);

CREATE INDEX IF NOT EXISTS branch_flip_events_socio_at
  ON branch_flip_events (socio_user_id, at);
