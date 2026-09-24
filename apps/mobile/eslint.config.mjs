import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint de la capa WEB. Las pantallas nativas/compartidas solo reciben una regla de aislamiento:
 * no pueden importar nada de src/web (código exclusivo de navegador).
 */
const webFiles = ['src/web/**/*.{ts,tsx}', 'src/**/*.web.{ts,tsx}', 'test/**/*.{ts,tsx}', 'scripts/**/*.ts'];

export default tseslint.config(
  { ignores: ['dist/**', 'dist-native/**', 'node_modules/**', '.expo/**', 'docs/**'] },
  {
    files: webFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended, jsxA11y.flatConfigs.strict, reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/no-noninteractive-tabindex': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/web/**', 'src/**/*.web.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/web', '@/web/*', '**/web/*', '**/web'], message: 'src/web es código solo de navegador: no lo importes desde código nativo/compartido.' }] },
      ],
    },
  },
);
