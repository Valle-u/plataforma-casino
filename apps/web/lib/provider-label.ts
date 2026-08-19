/**
 * Label visible del proveedor de juegos a partir de su `provider_code`.
 * Diferencia Palace vs Forever (y futuros) con un nombre lindo en vez del
 * code crudo. Fallback: el propio code.
 */
const PROVIDER_LABEL: Record<string, string> = {
  palace: 'Palace',
  forever: 'Forever',
};

export function providerLabel(code: string): string {
  return PROVIDER_LABEL[code] ?? code;
}
