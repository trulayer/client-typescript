import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Workspace packages (e.g. @trulayer/mcp) own their own vitest config
    // and coverage thresholds. The SDK suite only measures the SDK.
    include: ['tests/**/*.test.ts'],
    exclude: ['packages/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
      include: ['src/**'],
      exclude: [
        'dist/**',
        'tests/**',
        'packages/**',
        '*.config.ts',
        '*.config.mjs',
        // Node-only entry — tested via node-specific test suite
        'src/node.ts',
        // Type-only module — no executable branches
        'src/model.ts',
        // Browser relay sender — requires browser fetch/credentials environment;
        // covered by browser integration tests, not the Node vitest suite
        'src/browser-batch.ts',
      ],
    },
  },
})
