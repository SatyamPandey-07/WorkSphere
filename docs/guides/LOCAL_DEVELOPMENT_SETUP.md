# Local Development Guide: Clerk Webhooks & Profile Sync

## 1. Overview
This guide walks you through setting up local webhook ingestion and profile synchronization for WorkSphere using Clerk and tunneling tools.

---

## 2. Configuring `CLERK_WEBHOOK_SECRET`
1. Log in to your [Clerk Dashboard](https://dashboard.clerk.com/).
2. Navigate to your application and select **Webhooks** from the sidebar.
3. Click **Add Endpoint**.
4. Enter your local endpoint URL (e.g., `https://your-tunnel-url.ngrok-free.app/api/webhooks`).
5. Select the events you want to subscribe to (e.g., `user.created`, `user.updated`).
6. Once created, copy the **Signing Secret** (`whsec_...`).
7. Open your local `.env.local` file and add the secret:
   ```env
   CLERK_WEBHOOK_SECRET=whsec_your_actual_signing_secret_here