import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
      exclude: ['dist/**', 'tests/**', '*.config.ts', 'src/node.ts', 'src/model.ts'],
    },
  },
})
