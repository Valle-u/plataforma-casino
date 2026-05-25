// @ts-check
import baseConfig from '@casino/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // Specs + scripts CLI excluidos del tsconfig (solo compilamos
    // src/ a dist/). Cobertura de tests via vitest, no lint.
    ignores: [
      'eslint.config.js',
      'dist/**',
      '**/*.spec.ts',
      'src/scripts/**',
    ],
  },
];
