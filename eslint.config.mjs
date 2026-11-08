import parser from '@typescript-eslint/parser'
import plugin from '@typescript-eslint/eslint-plugin'
export default [{ ignores: ['**/dist/**', 'frontend/**'] }, { files: ['packages/**/*.ts', 'apps/**/*.ts'], languageOptions: { parser }, plugins: { '@typescript-eslint': plugin }, rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }]
