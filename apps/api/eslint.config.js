// @ts-check
import nestConfig from '@casino/eslint-config/nest';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nestConfig,
  // Sprint 54.x lint cleanup: 8 reglas degradadas en Sprint 54 fueron
  // limpiadas archivo-por-archivo y vueltas a 'error' (default del base
  // config). Lo único que queda como 'warn' acá son las reglas con
  // backlog real que no se limpiaron todavía. Cuando bajen a 0, sacar
  // el override.
  {
    files: ['src/**/*.ts'],
    rules: {
      // Backlog: ~250 violaciones — requiere tipar bien las queries
      // crudas de drizzle/postgres que devuelven `any[]`. Sprint dedicado.
      '@typescript-eslint/no-unsafe-member-access': 'warn',
    },
  },
  // El base config activa `projectService: true` — ESLint infiere el
  // tsconfig por archivo. Los tests viven en `test/**` pero el
  // `tsconfig.json` los excluye (solo compila `src/**`), entonces el
  // projectService no los encuentra. Override para tests: usar
  // `tsconfig.test.json` que sí los incluye.
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // En tests, las queries SQL crudas y los responses HTTP llegan como
    // `any`. Las rules type-checked sobre `any` se mantienen 'warn' acá
    // — la cobertura real viene de los asserts del test, no del
    // type-checker, y forzar guards en cada parse de response sería
    // ruido. En el código de producción (src/) sí queremos 'error'.
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Archivos fuera del tsconfig.json (excluidos por glob o que no
    // existen en src/), scripts ad-hoc, configs ESLint/Jest.
    ignores: [
      'scripts/**',
      'eslint.config.js',
      'jest.config.ts',
      'src/**/*.spec.ts', // excluidos del tsconfig.json — usan tsconfig.test
    ],
  },
];
