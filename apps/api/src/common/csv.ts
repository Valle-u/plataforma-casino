/**
 * CSV helper compartido para exports del panel admin.
 *
 * Diseño:
 *   - **Sin libs externas** — la spec CSV (RFC 4180) es chica y nuestras
 *     necesidades son: escapar quotes/commas/newlines, toString() honesto
 *     de Date/null/undefined/object.
 *   - **In-memory** para MVP — los listados del panel hoy están capeados
 *     en miles de rows (no millones). Si crecen, swappear a streaming
 *     (Readable stream con backpressure) sin cambiar la firma del helper.
 *   - **BOM UTF-8** opcional al inicio para que Excel detecte el encoding
 *     correcto (sin BOM, Excel asume Windows-1252 y rompe acentos).
 *
 * Convenciones:
 *   - Separador: coma. Newline: CRLF (per RFC 4180; Excel lo entiende mejor).
 *   - Headers en primera fila SIEMPRE.
 *   - Null/undefined → string vacío. Date → ISO 8601. Object/Array →
 *     JSON.stringify (encerrado entre quotes con escapado).
 *   - Booleanos → 'true' / 'false'.
 *   - BigInt → toString().
 */

const CRLF = '\r\n';
const BOM = '﻿';

/**
 * Definición de columna del CSV: header visible + función de extracción
 * desde la fila tipada. Permite columnas computadas (e.g. enriquecer con
 * datos derivados) sin tocar el shape de la row original.
 */
export interface CsvColumn<T> {
  header: string;
  /** Devuelve el valor "raw" de la celda. El helper se encarga del cast. */
  value: (row: T) => unknown;
}

export interface CsvBuildOptions {
  /** Si true (default), prepende BOM UTF-8 para que Excel respete acentos. */
  withBom?: boolean;
}

/**
 * Construye un string CSV completo a partir de columnas tipadas + filas.
 * Devuelve string listo para enviar como `text/csv`.
 */
export function buildCsv<T>(
  columns: CsvColumn<T>[],
  rows: T[],
  opts: CsvBuildOptions = {},
): string {
  const withBom = opts.withBom !== false;
  const headerLine = columns.map((c) => csvCell(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => csvCell(c.value(row))).join(','),
  );
  const body = [headerLine, ...dataLines].join(CRLF);
  return (withBom ? BOM : '') + body + CRLF;
}

/**
 * Escapa una celda según RFC 4180:
 *   - Si contiene `,`, `"` o newline → encerrar en `"..."` y duplicar quotes.
 *   - Si no, valor crudo.
 */
export function csvCell(value: unknown): string {
  const str = stringify(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Helper para armar el header `Content-Disposition` con un filename
 * limpio (sin chars que rompan en Windows/Linux/macOS).
 *
 * Pattern: `<entity>_<tenant>_<YYYY-MM-DD-HHmmss>.csv`.
 */
export function buildCsvFilename(entity: string, tenantSlug?: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const cleanEntity = entity.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const tenant = tenantSlug
    ? '_' + tenantSlug.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
    : '';
  return `${cleanEntity}${tenant}_${ts}.csv`;
}

/**
 * Cap de filas que cualquier export devuelve en sincrónico. Más que esto,
 * el operador debería usar el job async (post-MVP).
 */
export const CSV_EXPORT_MAX_ROWS = 50_000;
