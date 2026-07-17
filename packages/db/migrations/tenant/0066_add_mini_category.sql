-- Agrega categoría 'mini' al enum game_category para juegos mini de Palace.
ALTER TYPE "public"."game_category" ADD VALUE IF NOT EXISTS 'mini';
