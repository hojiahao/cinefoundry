// Writes docs/configuration.md from the settings table in src/lib/config.ts (run after the build: npm run docs:config).
import { writeFileSync } from 'node:fs'
import { configurationMarkdown } from '../dist/lib/config.js'
writeFileSync('docs/configuration.md', configurationMarkdown())
