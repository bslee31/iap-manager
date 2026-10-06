import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'
import prettierConfig from '@vue/eslint-config-prettier'

// Flat config (ESLint 10). Three-tier Electron app, so each src tree gets its
// own globals: main/preload run in Node, the renderer runs in Chromium with
// the contextBridge `window.api` surface.
export default defineConfig(
  {
    ignores: ['out/**', 'release/**', 'dist/**', 'node_modules/**', '.idea/**']
  },
  js.configs.recommended,
  // Apply TypeScript's core-rule overrides to Vue script blocks as well.
  tseslint.configs.recommended.map((config) =>
    config.files ? { ...config, files: [...config.files, '**/*.vue'] } : config
  ),
  pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue']
      }
    },
    rules: {
      'vue/block-lang': ['error', { script: { lang: 'ts' } }]
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'electron.vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },
  {
    rules: {
      // The codebase still has a sprinkling of `any` (mostly around third-
      // party API responses); keep as warning so it's visible without
      // turning every existing file red.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow leading-underscore intentional-skip args (e.g. `_event` in
      // ipcMain.handle callbacks).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Single-word component names like AppleProductTable are intentional
      // and consistent with the file naming.
      'vue/multi-word-component-names': 'off'
    }
  },
  // Must come last so it can disable conflicting style rules from the
  // configs above. Hands all whitespace / line-break decisions to Prettier.
  prettierConfig
)
