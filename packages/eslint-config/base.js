// @ts-check
/**
 * Base ESLint flat config for any TypeScript code in the monorepo.
 * Apps and packages extend this and add their own rules.
 *
 * Used via:
 *   import baseConfig from "@casino/eslint-config/base";
 *   export default [...baseConfig, { ...overrides }];
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // Permitimos prefijo _ para variables/args explícitamente sin uso
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Prohibir 'any' (decision en docs/02-arquitectura.md)
      "@typescript-eslint/no-explicit-any": "error",
      // Forzar consistencia en imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
    ],
  },
];
