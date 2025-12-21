import { defineConfig } from '@prisma/client/generator-helper';

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});
