// @ts-check
import baseConfig from '@casino/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
