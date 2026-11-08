import path from 'node:path'
import { defineConfig, env } from 'prisma/config'
import { config } from 'dotenv'

// Load environment variables from .env.local
config({ path: '.env.local' })

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'node prisma/seed.js',
  },

  datasource: {
    url: env('DATABASE_URL'),
  },
})
