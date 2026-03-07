import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Load environment variables from .env.local
import { config } from 'dotenv'
config({ path: '.env.local' })

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL
  },
  migrate: {
    adapter: async () => {
      // Dynamic import for postgres adapter
      const { PrismaPg } = await import('@prisma/adapter-pg')
      const { Pool } = await import('pg')
      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      return new PrismaPg(pool)
    }
  }
})
