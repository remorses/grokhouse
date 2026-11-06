// Tests run without the Cloudflare plugin from vite.config.ts: they only cover pure code.
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['src/**/*.test.ts', 'worker/**/*.test.ts'] } })
