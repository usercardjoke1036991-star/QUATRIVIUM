const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = defineConfig([
  {
    ignores: [
      'node_modules/**',
      'contracts/**',
      'android/**',
      'ios/**',
      'artifacts/**',
      'cache/**',
      'coverage/**',
      'dist/**',
      '.expo/**',
      'typechain-types/**',
      'forge-out/**',
      'forge-cache/**',
    ],
  },
  expoConfig,
  prettier,
  {
    files: ['test/**/*.js', 'scripts/**/*.cjs', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
  },
  {
    files: ['plugins/**/*.js', 'scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
