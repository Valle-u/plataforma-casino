-- Agrega el estado 'inactive' al enum user_status: usuarios desactivados
-- automáticamente por inactividad (no entran hace X días, configurable en
-- registration/users settings). Distinto de suspended/banned (manuales).
ALTER TYPE "public"."user_status" ADD VALUE IF NOT EXISTS 'inactive';
