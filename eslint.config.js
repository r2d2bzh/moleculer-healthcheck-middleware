import { defineConfig } from 'eslint/config';
import r2d2bzhEslintConfig from '@r2d2bzh/eslint-config';

export default defineConfig([
  {
    extends: [r2d2bzhEslintConfig],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]);
