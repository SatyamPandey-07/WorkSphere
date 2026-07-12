# Environment Variables & Secrets Configuration Matrix

This document provides a comprehensive breakdown of the application configuration variables, key generation pipelines, and local development configurations required to boot the application landscape.

---

## 1. Secrets & Core Keys Matrix

The application handles third-party services using environment parameters loaded during runtime initialization.

| Variable Key Name | Type | Service Provider | Context / Functional Utility |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | **Required** | Neon.tech / Postgres | Primary pooled database link (Transaction Mode) |
| `DIRECT_URL` | **Required** | Neon.tech / Postgres | Unpooled migration execution endpoint (Session Mode) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **Required** | Clerk Auth | Client-side user state interceptor token |
| `CLERK_SECRET_KEY` | **Required** | Clerk Auth | Server-side secure authentication wrapper key |
| `CSRF_SECRET` | *Optional* | Internal | HMAC secret used to sign CSRF tokens (`src/lib/csrf.ts`). Falls back to `CLERK_SECRET_KEY` if unset; a dev-only fallback is used outside production. Set this explicitly in production for a dedicated secret. |
| `GROQ_API_KEY` | **Required** | Groq Cloud | Injects rapid LLM text generation capabilities into the Chat API |
| `PEXELS_API_KEY` | *Optional* | Pexels Media | Sources real-world workplace dynamic fallback layouts and imagery |
| `SMTP_SERVER` / `SMTP_PASSWORD` | *Optional* | Custom Mailer | Outbound operational system transactional email dispatch |

---

## 2. API Credentials & Key Generation Tutorials

### A. Neon Database Core Provisioning
1. Navigate to the **[Neon.tech Dashboard](https://neon.tech/)** and create a new serverless project called `WorkSphere`.
2. Select your target cloud region and choose **PostgreSQL**.
3. Copy the **Pooled Connection String** provided on the main page. This string forms your `DATABASE_URL`.
4. Append `?sslmode=require&pgbouncer=true&connection_limit=1` to the URL parameter string.
5. In the dashboard settings, find the **Direct Connection String** toggle to grab your session mode url (`DIRECT_URL`).

### B. Groq Cloud Engine Integration
1. Go to the **[Groq Developer Portal](https://console.groq.com/)** and log in.
2. Select **API Keys** from the sidebar navigation tree.
3. Click **Create API Key**, label it `WorkSphere Dev Console`, and copy the string immediately.

### C. Pexels Stock Media Registry
1. Head over to the **[Pexels API Documentation Portal](https://www.pexels.com/api/)**.
2. Register a free developer account profile.
3. Tap **Request API Key**, fill out the basic intent text box (e.g., "Academic software dashboard optimization"), and copy the resulting string.

---

## 3. Local Development Mock Defaults (Offline Run)

If you are traveling, working offline, or don't want to sign up for external API providers, copy this boilerplate into your local **`.env.local`** file to safely run the UI layer:

```text
# Local Sandbox System-Wide Mock Parameter Bundle
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/worksphere?connection_limit=1"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/worksphere"

# Bypasses internal Clerk runtime parsing checks
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_bW9jay1jbGVyay1hcGkta2V5cy01NS5jbGVyay5hY2NvdW50cy5kZXYk
CLERK_SECRET_KEY=sk_test_mock_secret_key_long_enough_to_pass_validation_checks_safely

# Standard Offline Mock fallbacks
GROQ_API_KEY=gq_mock_key_offline_mode
PEXELS_API_KEY=px_mock_key_offline_mode