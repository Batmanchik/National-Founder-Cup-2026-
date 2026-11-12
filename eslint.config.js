// Правила кода Nazar. Запуск: npm run lint
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'voice/**', 'build/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-shadow': 'error',
      'no-console': 'off',
    },
  },
  {
    // Окна интерфейса: скрипты подключаются тегами <script>, общий код приходит глобалами.
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, NazarSprites: 'readonly', NazarUtil: 'readonly', Buddy: 'readonly' },
    },
  },
  {
    // Общие модули работают и в Node, и в браузере.
    files: ['src/shared/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
