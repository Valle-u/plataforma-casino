/**
 * Distancia de Levenshtein iterativa con dos filas.
 *
 * Usado para detectar emails / usernames similares (variaciones tipo
 * "juan@x.com" vs "juam@x.com" → distancia 1). Para volúmenes MVP
 * (<10k users) la complejidad O(N*M) por par + O(N²) sobre la lista
 * total es aceptable. Si crece, considerar:
 *   - Postgres `fuzzystrmatch` extension (`levenshtein()` nativo SQL).
 *   - Bucketing por primera letra para cortar comparaciones obviamente
 *     lejanas.
 *
 * Implementación clásica: matriz de costos comprimida en 2 filas.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Asegurar que `a` sea la más corta para minimizar memoria.
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const prev = new Array<number>(a.length + 1);
  const curr = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i += 1) prev[i] = i;

  for (let j = 1; j <= b.length; j += 1) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1]! + 1, // insertion
        prev[i]! + 1, // deletion
        prev[i - 1]! + cost, // substitution
      );
    }
    for (let i = 0; i <= a.length; i += 1) prev[i] = curr[i]!;
  }
  return prev[a.length]!;
}
