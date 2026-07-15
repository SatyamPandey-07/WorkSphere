# Environment Variables Reference

This document provides a complete reference for every environment variable used by WorkSphere. It explains the purpose of each variable, whether it is required, where its value comes from, and how it affects the application during development and deployment.

Properly configuring these variables is essential for enabling authentication, database connectivity, AI-powered features, media management, analytics, email notifications, and other platform services.

---

# Why Environment Variables?

WorkSphere relies on several third-party services to provide its core functionality. Instead of hardcoding sensitive information inside the source code, configuration values are supplied through environment variables.

This approach helps to:

- Keep API keys and secrets out of the codebase.
- Use different configurations for development, staging, and production.
- Rotate credentials without modifying application code.
- Improve application security and deployment flexibility.

> **Important**
>
> Environment variables containing sensitive credentials should never be committed to Git. Always configure them through your hosting provider's secure environment variable management system.

---

# Environment Variables Reference

The table below lists every environment variable currently used by WorkSphere.

| Variable | Required | Description |
|-----------|----------|-------------|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string used by Prisma ORM. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ Yes | Public Clerk authentication key used by the frontend. |
| `CLERK_SECRET_KEY` | ✅ Yes | Private Clerk secret used by server-side authentication. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | ✅ Yes | Route used for the sign-in page. |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | ✅ Yes | Route used for the registration page. |
| `WEBHOOK_SECRET` | ✅ Yes | Secret used to verify incoming Clerk webhook requests. |
| `GROQ_API_KEY` | ✅ Yes | Enables AI chat, recommendations, and agent-based features. |
| `COHERE_API_KEY` | Optional | Enables semantic search and AI memory capabilities. |
| `PEXELS_API_KEY` | Optional | Retrieves venue and gallery images from the Pexels API. |
| `UNSPLASH_ACCESS_KEY` | Optional | Access key for Unsplash image integration. |
| `NEXT_PUBLIC_UNSPLASH_ACCESS_KEY` | Optional | Client-side Unsplash access key where required. |
| `CLOUDINARY_CLOUD_NAME` | Optional | Cloudinary cloud identifier used for media uploads. |
| `CLOUDINARY_API_KEY` | Optional | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Optional | Cloudinary API secret. |
| `SMTP_HOST` | Optional | SMTP server hostname used for email delivery. |
| `SMTP_PORT` | Optional | SMTP server port. |
| `SMTP_USER` | Optional | SMTP account username. |
| `SMTP_PASS` | Optional | SMTP account password. |
| `UPSTASH_REDIS_REST_URL` | Optional | REST endpoint for the Upstash Redis instance. |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Authentication token for Upstash Redis. |
| `NEXT_PUBLIC_APP_URL` | Optional | Public application URL used for metadata and sharing links. |

---

# Service Configuration

The following services provide the credentials required by WorkSphere. Follow the steps below to obtain the necessary environment variables.

---

## PostgreSQL Database (`DATABASE_URL`)

WorkSphere uses **Prisma ORM** with a PostgreSQL database. The database connection string is stored in the `DATABASE_URL` environment variable.

### Recommended Providers

- Neon
- Supabase
- Railway
- Amazon RDS
- Self-hosted PostgreSQL

### Example

```env
DATABASE_URL="postgresql://username:password@host:5432/database?sslmode=require"
```

### Notes

- Ensure the database is reachable before starting the application.
- Run Prisma migrations after configuring the database.
- Never expose production database credentials publicly.

---

## Clerk Authentication

Clerk handles user authentication, session management, and webhooks.

### Required Variables

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
WEBHOOK_SECRET=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

### How to Obtain

1. Create a Clerk account.
2. Create a new application.
3. Open the application's API Keys page.
4. Copy the Publishable Key and Secret Key.
5. Generate a webhook endpoint if webhook support is enabled.

### Notes

- Variables beginning with `NEXT_PUBLIC_` are exposed to the browser.
- Keep `CLERK_SECRET_KEY` and `WEBHOOK_SECRET` private.

---

## Groq AI

Groq powers WorkSphere's AI chat, recommendations, and multi-agent workflows.

### Required Variable

```env
GROQ_API_KEY=
```

### How to Obtain

1. Create a Groq account.
2. Open the API Keys dashboard.
3. Generate a new API key.
4. Copy the generated key into your environment file.

### Notes

- AI features will not work without this key.
- Rotate API keys if they are accidentally exposed.

---

## Cohere

Cohere provides semantic search and embedding capabilities.

### Variable

```env
COHERE_API_KEY=
```

### Notes

- This integration is optional.
- If omitted, semantic search and memory-related features are disabled while the rest of the application continues to function normally.

---

## Pexels

Pexels supplies high-quality venue and gallery images.

### Variable

```env
PEXELS_API_KEY=
```

### How to Obtain

1. Create a Pexels account.
2. Open the API dashboard.
3. Generate an API key.
4. Add the key to your environment configuration.

### Notes

If this variable is not configured, WorkSphere falls back to default or placeholder images where supported.

---

## Unsplash

Unsplash can also be used as an image provider.

### Variables

```env
UNSPLASH_ACCESS_KEY=
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=
```

### Notes

This integration is optional and serves as an additional image source.

---

## Cloudinary

Cloudinary manages media uploads and storage.

### Required Variables

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

### How to Obtain

1. Create a Cloudinary account.
2. Open the Dashboard.
3. Copy your Cloud Name, API Key, and API Secret.

### Notes

All three variables must be configured for image uploads to work correctly.

---

## SMTP Configuration

SMTP credentials are used to send booking confirmations and notification emails.

### Variables

```env
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

### Common Providers

- Gmail SMTP
- Outlook SMTP
- SendGrid
- Mailgun
- Amazon SES

### Notes

Ensure your SMTP provider allows authenticated connections before deploying.

---

## Upstash Redis

Upstash Redis is used for analytics and request rate limiting.

### Variables

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### How to Obtain

1. Create an Upstash account.
2. Create a Redis database.
3. Copy the REST URL and REST Token from the dashboard.

### Notes

If Redis is not configured, analytics and rate-limiting features may be unavailable.

---

# Local Development

Create a `.env.local` file in the project root before starting the application.

A minimal local configuration looks like this:

```env
# Database
DATABASE_URL=

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
WEBHOOK_SECRET=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# AI
GROQ_API_KEY=

# Optional Integrations
COHERE_API_KEY=
PEXELS_API_KEY=
UNSPLASH_ACCESS_KEY=
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Only configure the services you plan to use during local development. Optional integrations can be added later without affecting the core application.

---

# Local Development Fallbacks

Several WorkSphere features are designed to degrade gracefully when optional services are unavailable.

| Service | Behaviour When Not Configured |
|----------|-------------------------------|
| Cohere | Semantic search and AI memory features are disabled. |
| Pexels | Placeholder or fallback images are displayed where supported. |
| Unsplash | Optional image lookup is unavailable. |
| Cloudinary | Media upload functionality is disabled. |
| SMTP | Confirmation emails are not sent. |
| Upstash Redis | Analytics and rate limiting are disabled. |

The following services are required for the application to function correctly:

- PostgreSQL (`DATABASE_URL`)
- Clerk Authentication
- Groq AI

---

# Security Best Practices

Follow these recommendations when working with environment variables:

- Never commit `.env.local` or other secret files to version control.
- Store production secrets using your hosting provider's environment variable manager.
- Rotate API keys immediately if they are accidentally exposed.
- Keep server-side secrets private and never expose them to client-side code.
- Only variables prefixed with `NEXT_PUBLIC_` should be accessible in the browser.
- Review and remove unused credentials periodically.

---

# Troubleshooting

## Database Connection Errors

If the application cannot connect to the database:

- Verify that `DATABASE_URL` is correctly configured.
- Ensure the PostgreSQL server is running and accessible.
- Run Prisma migrations if the database has not been initialized.
- Regenerate the Prisma Client after schema changes.

---

## Authentication Issues

If users cannot sign in or sign up:

- Verify the Clerk publishable and secret keys.
- Confirm that `WEBHOOK_SECRET` matches the value configured in the Clerk dashboard.
- Ensure the authentication routes are correctly configured.

---

## AI Features Not Working

If AI-powered features fail:

- Verify that `GROQ_API_KEY` is valid.
- If semantic search is enabled, confirm that `COHERE_API_KEY` is also configured.
- Check API usage limits or quota restrictions.

---

## Image Loading Problems

If venue or gallery images are missing:

- Verify the Pexels or Unsplash API keys.
- Confirm that external API requests are not being blocked.
- Check whether fallback images are being displayed.

---

## Media Upload Failures

If image uploads do not complete successfully:

- Verify all Cloudinary credentials.
- Ensure the Cloudinary account is active.
- Confirm that upload presets and permissions are correctly configured.

---

## Email Delivery Problems

If booking confirmation emails are not being delivered:

- Verify the SMTP host, port, username, and password.
- Ensure the SMTP provider allows authenticated connections.
- Check spam or junk folders when testing.

---

## Analytics or Rate Limiting

If analytics or request rate limiting is unavailable:

- Verify the Upstash Redis REST URL and REST Token.
- Confirm that the Redis instance is active.
- Check network connectivity between the application and the Redis service.

---

# Frequently Asked Questions

### Why should `.env.local` never be committed?

It contains sensitive credentials that could expose production services or third-party accounts if published.

---

### Which environment variables are safe to expose publicly?

Only variables prefixed with `NEXT_PUBLIC_` are intended for use in client-side code.

---

### Can I run WorkSphere without configuring every service?

Yes. Several integrations are optional. Features such as semantic search, image providers, analytics, email delivery, and media uploads will be unavailable until their corresponding environment variables are configured.

---

# Summary

Environment variables provide the configuration layer that allows WorkSphere to integrate securely with external services. Keeping these values organized, protected, and correctly configured helps ensure reliable development, testing, and production deployments.