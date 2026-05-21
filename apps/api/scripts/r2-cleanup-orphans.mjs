/**
 * scripts/r2-cleanup-orphans.mjs
 *
 * Lista (default) o borra (--apply) los objetos del bucket R2 bajo
 * `tenants/<slug>/deposits/proofs/` para limpiar archivos huérfanos
 * dejados por los stress tests E2E.
 *
 * Uso:
 *   node scripts/r2-cleanup-orphans.mjs                    # solo lista
 *   node scripts/r2-cleanup-orphans.mjs --apply            # borra
 *   node scripts/r2-cleanup-orphans.mjs --prefix tenants/demo/ --apply
 *
 * Lee credenciales de apps/api/.env.local (R2_*).
 */

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const prefixArgIdx = args.indexOf('--prefix');
const prefix =
  prefixArgIdx >= 0 ? args[prefixArgIdx + 1] : 'tenants/demo/deposits/proofs/';

const required = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Falta env: ${k}`);
    process.exit(1);
  }
}

const client = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
const bucket = process.env.R2_BUCKET;

console.log(`Bucket: ${bucket}`);
console.log(`Prefix: ${prefix}`);
console.log(`Modo:   ${apply ? 'APPLY (borrar)' : 'DRY-RUN (solo listar)'}`);
console.log('---');

let continuationToken;
let totalListed = 0;
let totalBytes = 0;
let totalDeleted = 0;
const sample = [];

do {
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }),
  );
  const objs = res.Contents ?? [];
  totalListed += objs.length;
  for (const o of objs) {
    totalBytes += o.Size ?? 0;
    if (sample.length < 5) sample.push(`${o.Key} (${o.Size}B)`);
  }

  if (apply && objs.length > 0) {
    const batch = objs.map((o) => ({ Key: o.Key }));
    const del = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      }),
    );
    totalDeleted += batch.length - (del.Errors?.length ?? 0);
    if (del.Errors?.length) {
      console.error('Errores en delete batch:', del.Errors);
    }
  }

  continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (continuationToken);

console.log(`Objetos encontrados: ${totalListed}`);
console.log(`Tamaño total:        ${(totalBytes / 1024).toFixed(1)} KB`);
if (sample.length) {
  console.log('Sample:');
  for (const s of sample) console.log(`  - ${s}`);
}
if (apply) {
  console.log(`Borrados: ${totalDeleted}`);
} else {
  console.log('\n(Re-ejecutar con --apply para borrar.)');
}
