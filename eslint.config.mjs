import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['apps/mobile/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/api/**', 'e2e/**'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Ionic nutzt Web-Component-Slots (z.B. <ion-tab-bar slot="bottom">) — kein Vue-2-Slot
      'vue/no-deprecated-slot-attribute': 'off',
    },
  },
)
