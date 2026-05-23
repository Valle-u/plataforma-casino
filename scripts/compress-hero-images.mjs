#!/usr/bin/env node
/**
 * Comprime las imágenes hero PNG a WebP (calidad ~82) y AVIF (calidad ~60).
 *
 * Origen: apps/web/public/hero/*.png
 * Output: apps/web/public/hero/*.webp + *.avif
 *
 * Next.js sirve la mejor variante según Accept header del browser.
 * El PNG original queda como fallback / source-of-truth — opcional borrarlo
 * después con --delete-source si querés ahorrar espacio de repo.
 *
 * Run: node scripts/compress-hero-images.mjs [--delete-source]
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, parse } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(__filename, '..', '..');
// Sprint 51.18 update: parametrizable — por default sigue siendo /hero,
// pero el script lo usa también para /bg (fondos de plataforma).
const SUBDIR = process.env.IMG_DIR ?? 'hero';
const HERO_DIR = join(ROOT, 'apps', 'web', 'public', SUBDIR);

// pnpm hace que sharp viva en .pnpm/sharp@x.y.z/node_modules/sharp y no es
// resolvible desde el root vía bare import. Usamos createRequire apuntado al
// package.json de sharp en pnpm-store.
const sharpEntry = join(
  ROOT,
  'node_modules',
  '.pnpm',
  'sharp@0.34.5',
  'node_modules',
  'sharp',
  'lib',
  'index.js',
);
const sharpUrl = pathToFileURL(sharpEntry).href;
const { default: sharp } = await import(sharpUrl);

const DELETE_SOURCE = process.argv.includes('--delete-source');

const files = readdirSync(HERO_DIR).filter((f) => f.toLowerCase().endsWith('.png'));

if (files.length === 0) {
  console.log('No PNG files in', HERO_DIR);
  process.exit(0);
}

console.log(`Procesando ${files.length} imágenes en ${HERO_DIR}\n`);

let totalOriginal = 0;
let totalWebp = 0;
let totalAvif = 0;

for (const file of files) {
  const src = join(HERO_DIR, file);
  const { name } = parse(file);
  const webpOut = join(HERO_DIR, `${name}.webp`);
  const avifOut = join(HERO_DIR, `${name}.avif`);

  const originalSize = statSync(src).size;
  totalOriginal += originalSize;

  // Resize si es muy grande (max 1920px ancho — más que eso es desperdicio
  // para hero, y el browser ya hace downscale).
  const pipeline = sharp(src).resize({ width: 1920, withoutEnlargement: true });

  await pipeline.clone().webp({ quality: 82, effort: 5 }).toFile(webpOut);
  await pipeline.clone().avif({ quality: 60, effort: 5 }).toFile(avifOut);

  const webpSize = statSync(webpOut).size;
  const avifSize = statSync(avifOut).size;
  totalWebp += webpSize;
  totalAvif += avifSize;

  const fmtKb = (b) => `${(b / 1024).toFixed(0)}KB`;
  const pctWebp = ((1 - webpSize / originalSize) * 100).toFixed(0);
  const pctAvif = ((1 - avifSize / originalSize) * 100).toFixed(0);

  console.log(
    `  ${file.padEnd(20)} ${fmtKb(originalSize).padStart(8)} → ` +
      `webp ${fmtKb(webpSize).padStart(7)} (-${pctWebp}%)  ` +
      `avif ${fmtKb(avifSize).padStart(7)} (-${pctAvif}%)`,
  );

  if (DELETE_SOURCE) {
    unlinkSync(src);
  }
}

const fmtMb = (b) => `${(b / 1024 / 1024).toFixed(2)}MB`;
console.log(`\n── Totales ──`);
console.log(`  PNG original: ${fmtMb(totalOriginal)}`);
console.log(`  WebP:         ${fmtMb(totalWebp)}  (-${((1 - totalWebp / totalOriginal) * 100).toFixed(0)}%)`);
console.log(`  AVIF:         ${fmtMb(totalAvif)}  (-${((1 - totalAvif / totalOriginal) * 100).toFixed(0)}%)`);

if (DELETE_SOURCE) {
  console.log(`\n🗑️  PNGs originales borrados (--delete-source).`);
} else {
  console.log(`\n💡 Para borrar los PNGs originales: --delete-source`);
}
