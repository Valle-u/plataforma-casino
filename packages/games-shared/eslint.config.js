// @ts-check
import baseConfig from '@casino/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // Specs excluidos del tsconfig.json (compilamos solo src para
    // dist). El projectService de ESLint no los encuentra; los
    // ignoramos para lint también — la cobertura viene de vitest.
    ignores: ['eslint.config.js', 'dist/**', '**/*.spec.ts'],
  },
];
