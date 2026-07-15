# Prisma Troubleshooting Guide

This guide provides practical solutions for common Prisma issues that contributors may encounter while working on WorkSphere.

It focuses on:

- Resolving migration drift
- Safely resetting the local database
- Creating and applying migrations
- Running and customizing database seed data
- Common troubleshooting tips for local development

---

# Understanding Migration Drift

Migration drift occurs when the actual database schema no longer matches Prisma's migration history. This usually happens after manual database changes, deleted migration files, or switching between branches.

## Check the current migration status

```bash
npx prisma migrate status
```

Review the output before making any changes. If Prisma reports drift or pending migrations, resolve those issues before continuing development.

## Mark a migration as applied

If a migration has already been applied manually, record it in Prisma's migration history:

```bash
npx prisma migrate resolve --applied <migration_name>
```

Example:

```bash
npx prisma migrate resolve --applied 20260712123000_add_pet_filters
```

## Mark a migration as rolled back

If a migration failed or was reverted manually:

```bash
npx prisma migrate resolve --rolled-back <migration_name>
```

> Only use `migrate resolve` when you fully understand the current database state. Incorrect usage can leave migration history inconsistent.

---

# Resetting the Local Database

If your development database becomes inconsistent or corrupted, the safest approach is to recreate it from scratch.

```bash
npx prisma migrate reset
```

This command performs the following steps automatically:

- Drops the existing database
- Creates a fresh database
- Applies all migrations
- Executes the configured seed script

Since this operation permanently removes local data, avoid using it on databases containing important information.

---

# Creating New Migrations

Whenever `prisma/schema.prisma` is modified, create a migration instead of changing the database manually.

```bash
npx prisma migrate dev --name descriptive_migration_name
```

Example:

```bash
npx prisma migrate dev --name add_pet_friendly_fields
```

After the migration completes successfully, regenerate the Prisma Client:

```bash
npx prisma generate
```

---

# Updating the Schema Without Migrations

For quick local experimentation:

```bash
npx prisma db push
```

This synchronizes the database schema directly without creating a migration.

It is useful during rapid development but should not replace proper migrations for production-ready changes.

---

# Running Seed Data

Populate the database with sample data using:

```bash
npx prisma db seed
```

or

```bash
node prisma/seed.js
```

## Customizing Seed Coordinates

The project seed file contains sample venue locations.

Open:

```
prisma/seed.js
```

Update the latitude and longitude values before running the seed script if you want to generate sample venues for another city or region.

---

# Common Issues

## DATABASE_URL is not configured

Prisma requires a valid database connection string.

Create a `.env.local` file containing:

```env
DATABASE_URL="postgresql://username:password@host/database?sslmode=require"
```

Verify the connection string before running any migration commands.

---

## Migration Failed

First inspect the migration history:

```bash
npx prisma migrate status
```

If the migration has already been executed outside Prisma, mark it as applied:

```bash
npx prisma migrate resolve --applied <migration_name>
```

If the local database is no longer recoverable:

```bash
npx prisma migrate reset
```

---

## Prisma Client Out of Date

After modifying the schema or switching branches, regenerate the client:

```bash
npx prisma generate
```

---

# Frequently Used Commands

| Purpose | Command |
|---------|---------|
| Validate schema | `npx prisma validate` |
| Format schema | `npx prisma format` |
| Generate Prisma Client | `npx prisma generate` |
| Open Prisma Studio | `npx prisma studio` |
| Check migration status | `npx prisma migrate status` |
| Create migration | `npx prisma migrate dev` |
| Reset local database | `npx prisma migrate reset` |
| Seed database | `npx prisma db seed` |

---

# Best Practices

- Always create migrations after modifying `schema.prisma`.
- Avoid editing committed migration files.
- Keep `DATABASE_URL` inside `.env.local` and never commit it.
- Run `npx prisma generate` after schema changes.
- Test migrations locally before opening a pull request.
- Prefer descriptive migration names that clearly explain the change.

---

# Recovery Scenarios

## Scenario 1: Switched Git Branches and Migrations Conflict

When switching between branches, your local database may no longer match the migration history.

Recommended steps:

```bash
npx prisma migrate status
```

If the database cannot be synchronized safely:

```bash
npx prisma migrate reset
```

Finally, regenerate the Prisma Client:

```bash
npx prisma generate
```

---

## Scenario 2: Prisma Client Types Are Incorrect

If TypeScript reports missing model fields after modifying `schema.prisma`, regenerate the client:

```bash
npx prisma generate
```

Restart your development server if necessary.

---

## Scenario 3: Seed Script Doesn't Reflect Changes

If new fields were added to the schema but seed data is unchanged:

1. Update `prisma/seed.js`
2. Reset or reseed the database

```bash
npx prisma migrate reset
```

or

```bash
npx prisma db seed
```

---

# Frequently Asked Questions

### When should I use `db push` instead of migrations?

Use `db push` only during rapid local development or experimentation.

For any feature that will be committed, prefer:

```bash
npx prisma migrate dev
```

---

### Is `migrate reset` safe?

Yes—for local development only.

It permanently deletes all existing data before rebuilding the database.

Never use it against production databases.

---

### Should migration files be edited?

No.

Once a migration has been committed, create a new migration instead of modifying existing ones.

---

# Additional Resources

- Prisma Migrate Documentation
- Prisma Schema Reference
- Prisma CLI Reference

Refer to the official Prisma documentation for advanced migration strategies and deployment recommendations.

---

## Summary

If you encounter database issues while contributing to WorkSphere, follow this order:

1. Check migration status

```bash
npx prisma migrate status
```

2. Resolve migration history if required

```bash
npx prisma migrate resolve
```

3. Reset the local database if necessary

```bash
npx prisma migrate reset
```

4. Regenerate the Prisma Client

```bash
npx prisma generate
```

5. Run the seed script

```bash
npx prisma db seed
```

Following this workflow helps keep the local database, migration history, and Prisma Client synchronized, reducing setup issues and making collaboration smoother for all contributors.