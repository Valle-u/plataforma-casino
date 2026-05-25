// @ts-check
import nextConfig from '@casino/eslint-config/next';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextConfig,
  // Plugins de Next + react-hooks. Cargados para que ESLint reconozca
  // los rules referenciados en eslint-disable comments. Las rules en sí
  // las dejamos OFF abajo — limpiar uses de <img>/<Image> y depends
  // arrays es seguimiento del sprint de lint debt.
  {
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
  },
  {
    // Ignorar artefactos de build de Next, config files fuera del tsconfig,
    // y archivos generados por Next que no son nuestros.
    ignores: [
      '.next/**',
      'next-env.d.ts',
      'out/**',
      'next.config.ts',
      'postcss.config.mjs',
      'eslint.config.js',
    ],
  },
  {
    // Overrides para código de UI React (Sprint 54):
    //
    // Las reglas type-checked del base config son útiles para backend
    // (Nest) pero generan falsos positivos en patrones React legítimos:
    //   - useEffect/handlers a menudo invocan promesas sin await porque
    //     React 19 los ignora intencionalmente (fire-and-forget para
    //     actualizar state). El void wrap es ruido visual.
    //   - El navegador no esperá tampoco a esas promesas, así que el
    //     error real-world es bajo si la lógica no depende del result.
    //
    // Sprint 54.x lint cleanup: las reglas chicas (no-base-to-string,
    // only-throw-error, no-empty-object-type, no-unused-expressions,
    // no-redundant-type-constituents, no-unnecessary-type-assertion) se
    // limpiaron a 0 y quedaron como 'error' por default. Solo quedan
    // como 'warn' las grandes con backlog real (~480 warnings totales)
    // que requieren un sprint dedicado de typing.
    rules: {
      // ── React patterns con backlog grande ──
      // no-floating-promises: 130+ ocurrencias en handlers/effects que
      //   son fire-and-forget intencional. Cleanup mecánico con `void`
      //   prefix, pero hay que validar caso por caso.
      // no-misused-promises: 100+ en onClick={async () => ...} típico
      //   de React Query mutations. Patrón: () => void mutation.mutateAsync().
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',

      // ── no-unsafe-*: ~250 ocurrencias por API responses sin tipo ──
      // Cleanup requiere generar tipos del backend y usarlos en los
      // hooks de useQuery. Sprint dedicado.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // ── Reglas referenciadas en eslint-disable comments del codebase ──
      // Las apagamos para que ESLint no reporte por las directivas
      // mientras no se haga el sweep de <img>/<Image> y depends arrays.
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];
