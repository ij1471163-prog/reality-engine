module.exports = {
  root:    true,
  parser:  '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react-native', 'react-hooks'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    '@typescript-eslint/no-explicit-any':          'error',
    '@typescript-eslint/no-unused-vars':           'error',
    '@typescript-eslint/no-floating-promises':     'error',
    '@typescript-eslint/await-thenable':           'error',
    'react-hooks/rules-of-hooks':                  'error',
    'react-hooks/exhaustive-deps':                 'warn',
    'react-native/no-inline-styles':               'warn',
    'react-native/no-color-literals':              'warn',
    'react-native/no-unused-styles':               'warn',
  },
  ignorePatterns: ['node_modules/', 'dist/', '.expo/', 'babel.config.js'],
};
