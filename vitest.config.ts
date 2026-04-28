import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    // Avoid scanning Electron build output and packaged release artefacts.
    exclude: ['node_modules', 'out', 'release', 'dist']
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
