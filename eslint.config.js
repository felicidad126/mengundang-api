// Lint tanpa informasi tipe, jadi bisa jalan sebelum build; cek tipe dikerjakan `pnpm build`.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'coverage/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
