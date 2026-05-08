// @ts-check
/**
 * ESLint config for Next.js apps.
 * Extiende el base y agrega reglas para React + JSX + Next.
 *
 * Las dependencias específicas de Next (eslint-config-next, etc.) se instalan
 * en el package.json de cada app web, no acá, para evitar bloat en otros packages.
 */

import baseConfig from "./base.js";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
