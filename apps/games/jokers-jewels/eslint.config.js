// @ts-check
import baseConfig from '@casino/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: [
      'eslint.config.js',
      'dist/**',
      'vite.config.ts',
      'src/App.legacy.tsx',
      'src/components.legacy/**',
    ],
  },
  {
    // Cliente React: relajamos rules que son ruido en este tipo de código.
    files: ['src/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
    },
  },
];
