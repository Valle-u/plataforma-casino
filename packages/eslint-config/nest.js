// @ts-check
/**
 * ESLint config for NestJS apps.
 * Extiende el base y permite los patrones específicos de NestJS:
 * - Decoradores
 * - Inyección de dependencias en constructores
 * - Métodos vacíos en clases (lifecycle hooks opcionales)
 */

import baseConfig from "./base.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    rules: {
      // NestJS usa decoradores que no son llamadas a funciones desde el punto
      // de vista de TS, así que algunas reglas estrictas hay que relajarlas.
      "@typescript-eslint/no-extraneous-class": "off",
      // Permitir parámetros con prefijo readonly (típico en constructors NestJS)
      "@typescript-eslint/parameter-properties": "off",
      // NestJS usa interfaces vacías para markers (Module, Guard, etc.)
      "@typescript-eslint/no-empty-interface": "off",
    },
  },
];
