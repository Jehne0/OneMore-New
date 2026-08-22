// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'functions/lib/**'],
    rules: {
      // These effects reset UI state while synchronizing auth, Firestore, and modal lifecycles.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
