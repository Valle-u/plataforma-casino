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
  // Los .e2e.ts están excluidos de tsconfig.json y tsconfig.test.json
  // (el pattern **/*.e2e.ts los excluye), así que projectService no
  // puede resolverlos. Se ignoran en ESLint.
  {
    ignores: ['src/test/e2e/**'],
  },
  // Los helpers y setup de tests están bajo src/test/ y excluidos de
  // tsconfig.json. tsconfig.test.json sí los incluye (quita src/test/**
  // del exclude), así que se resuelven con projectService apuntando a
  // tsconfig.test.json. Rules más laxas porque son helpers de test.
  {
    files: ['src/test/helpers/**', 'src/test/setup/**'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
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
      'src/**/*.spec.ts',
      'src/scripts/**', // excluido de ambos tsconfigs
    ],
  },
];
