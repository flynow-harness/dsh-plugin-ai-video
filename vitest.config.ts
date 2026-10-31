import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    passWithNoTests: false,
    testTimeout: 30_000,
  },
})
