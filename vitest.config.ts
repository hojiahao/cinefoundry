import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000, globalSetup: ['tests/global-setup.ts'] } })
