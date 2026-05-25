// @ts-check
import baseConfig from '@casino/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  // Base config ya activa `projectService: true`; no especificar `project`
  // aquí (causa "Enabling project does nothing when projectService is enabled").
  {
    // Archivos de configuración fuera del tsconfig.json — el projectService
    // no los encuentra y no son código de runtime.
    ignores: [
      'drizzle.control.config.ts',
      'drizzle.tenant.config.ts',
      'eslint.config.js',
    ],
  },
];
