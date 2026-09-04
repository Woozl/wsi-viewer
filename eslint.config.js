import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist', 'vendor', 'wasm/target', 'public/wasm', 'playwright-report', 'test-results'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      // A canvas-based map is role="application" and must be focusable for
      // OpenLayers' keyboard pan and zoom to reach it.
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        // A focusable separator with aria-valuenow is the ARIA window-splitter
        // pattern, which the rule does not model.
        { tags: [], roles: ['tabpanel', 'application', 'separator'] },
      ],
      'jsx-a11y/no-noninteractive-element-interactions': [
        'error',
        { handlers: ['onClick', 'onMouseDown', 'onMouseUp', 'onKeyPress', 'onKeyUp'] },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // The brief calls for strict typing with no escape hatches.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Assertions are discouraged rather than banned: the WASM and JSON
      // boundaries narrow via runtime-checked type predicates, but banning `as`
      // outright makes WebAssembly.Exports impossible to type honestly.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      // Interface-mandated parameters (WASI descriptors) are prefixed with _.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // shadcn primitives export their `cva` variant helper alongside the
    // component, which Fast Refresh cannot support.
    files: ['src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // TanStack Router's file-based routes must export both `Route` and the
    // component from the same module, which Fast Refresh cannot support.
    files: ['src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Config and Node-side scripts run outside the browser.
    files: ['*.config.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
