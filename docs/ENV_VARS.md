# Environment Variables Reference

This document provides a complete reference for every environment variable used by WorkSphere. It explains the purpose of each variable, whether it is required, where its value comes from, how built-in development fallbacks operate, and how to obtain free developer keys.

Properly configuring these variables is essential for enabling authentication, database connectivity, AI-powered features, media management, analytics, email notifications, and other platform services.

---

# Why Environment Variables?

WorkSphere relies on third-party services to provide core functionality. Instead of hardcoding sensitive credentials in source code, configuration values are supplied through environment variables.

This approach helps to:

- Keep API keys and secrets out of the codebase.
- Use different configurations for development, staging, and production.
- Rotate credentials without modifying application code.
- Enable graceful feature degradation and local in-memory mocks during development.

> **Important**
>
> Environment variables containing sensitive credentials should never be committed to Git. Always configure them through `.env.local` locally and through your hosting provider's secure environment variable management system in production.

---

# Categorized Environment Variables Reference

WorkSphere categorizes environment variables into three distinct tiers: **Core Required**, **Optional with Local Fallback**, and **Third-Party Integrations**.

## 1. Core Required Variables

These variables are mandatory for starting the application and running core authentication, database, and AI workflows.

| Variable | Required Scope | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | ✅ All Environments | PostgreSQL connection string (Neon, Supabase, Docker Postgres, etc.) used by Prisma ORM. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ All Environments | Public Clerk authentication key used by client-side components. |
| `CLERK_SECRET_KEY` | ✅ All Environments | Private Clerk secret used for server-side session and user verification. |
| `WEBHOOK_SECRET` | ✅ All Environments | Signing secret used to verify incoming Clerk webhook events. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | ✅ All Environments | Route for the sign-in page (`/sign-in`). |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | ✅ All Environments | Route for the sign-up page (`/sign-up`). |
| `GROQ_API_KEY` | ✅ All Environments | Enables AI chat, space recommendations, and autonomous multi-agent workflows. |
| `CRON_SECRET` | ✅ Production Only | Bearer token securing scheduled cron endpoints and automated partition maintenance. |
| `PARTITION_MAINTENANCE_ADMIN_ID` | ✅ Production Only | ID of an admin user recorded as actor in partition maintenance audit logs. |

---

## 2. Optional Variables with Built-In Local Fallbacks

These variables power auxiliary features. If left unset during local development, WorkSphere uses built-in in-memory mocks, fallback secrets, or placeholder assets so the app runs smoothly without error.

| Variable | Fallback Mechanism in Local Development | Description |
| :--- | :--- | :--- |
| `UPSTASH_REDIS_REST_URL` | In-Memory LRU / Map Store | Upstash Redis REST URL. Unset locally falls back to an in-memory rate-limiter and cache mock. |
| `UPSTASH_REDIS_REST_TOKEN` | In-Memory LRU / Map Store | Upstash Redis REST token for request rate-limiting and analytics. |
| `CSRF_SECRET` | `CLERK_SECRET_KEY` / Dev Default | Secret for signing CSRF tokens. Unset falls back to `CLERK_SECRET_KEY` or dev fallback. |
| `PASSKEY_OTP_SECRET` | `CSRF_SECRET` / `CLERK_SECRET_KEY` | HMAC secret for passkey OTP verification. Falls back to CSRF/Clerk secret chain. |
| `PEXELS_API_KEY` | Built-in Unsplash & Static Placeholders | Venue and gallery photo retrieval. Unset falls back to static curated workspace images. |
| `UNSPLASH_ACCESS_KEY` | Static Placeholder Images | Client/Server Unsplash photo integration fallback. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Application base URL used for metadata, social cards, and share links. |

---

## 3. Third-Party Integrations

These integrations enable specific extended capabilities when credentials are provided, degrading gracefully when omitted.

| Variable | Integration Purpose | Behavior When Omitted |
| :--- | :--- | :--- |
| `COHERE_API_KEY` | Semantic Search & RAG Embeddings | Semantic search & memory features are disabled. |
| `CLOUDINARY_CLOUD_NAME` | Cloud Media Storage & Image Optimization | Media upload functionality is disabled. |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | Media upload functionality is disabled. |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret | Media upload functionality is disabled. |
| `SMTP_HOST` | Email Notifications & Passkey OTPs | Confirmation emails and OTP passkey resets return `503`. |
| `SMTP_PORT` | SMTP Port (587 / 465) | Email delivery disabled. |
| `SMTP_USER` | SMTP Username | Email delivery disabled. |
| `SMTP_PASS` | SMTP Password | Email delivery disabled. |
| `PARTYKIT_AUTH_SECRET` | Real-time WebSocket Collaboration | Shared secret securing PartyKit room auth endpoints. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push Notifications | Browser push notification subscription disabled. |
| `VAPID_PRIVATE_KEY` | Web Push Payload Signing | Server push delivery disabled. |
| `VAPID_SUBJECT` | VAPID Contact Mailto / URL | Server push delivery disabled. |

---

# How to Obtain Free Developer Keys

WorkSphere can be developed locally entirely on **free tier** developer resources. Follow these quick guides to set up core required services:

### 1. PostgreSQL Database (Neon Free Tier)
1. Visit [neon.tech](https://neon.tech) and sign up for a free account.
2. Click **Create Project**, name your project `worksphere-dev`, and select your preferred region.
3. On the dashboard, copy the PostgreSQL connection string.
4. Add to `.env.local`:
   ```env
   DATABASE_URL="postgresql://user:password@ep-cool-db-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```

### 2. Clerk Authentication (Free Developer Plan)
1. Visit [clerk.com](https://clerk.com) and sign up for a free account.
2. Click **Add Application**, name it `WorkSphere Local`, and enable Email + Social logins.
3. Under **API Keys** in the Clerk Dashboard, copy your Publishable Key and Secret Key.
4. Add to `.env.local`:
   ```env
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   WEBHOOK_SECRET=whsec_...
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
   ```

### 3. Groq AI Engine (Free API Key)
1. Visit [console.groq.com](https://console.groq.com) and sign up.
2. Navigate to **API Keys** and click **Create API Key**.
3. Copy the generated key.
4. Add to `.env.local`:
   ```env
   GROQ_API_KEY=gsk_...
   ```

---

# Minimal Local Development Configuration

Create a `.env.local` file in the repository root. A minimal working setup requires only Core Required variables:

```env
# Core Required: Database
DATABASE_URL="postgresql://user:password@localhost:5432/worksphere"

# Core Required: Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"

# Core Required: Groq AI Engine
GROQ_API_KEY="gsk_..."

# Optional Development Fallbacks (Pre-configured defaults)
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

# Security & Deployment Best Practices

- Never commit `.env.local` or environment secrets to version control.
- Ensure all client-accessible variables are explicitly prefixed with `NEXT_PUBLIC_`. Server-side variables without this prefix are hidden from the browser bundle.
- In production (Vercel, AWS, Railway), configure secrets using the platform's Environment Variables panel.