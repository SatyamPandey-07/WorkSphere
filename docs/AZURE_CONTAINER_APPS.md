# Deploying SecureFlow to Microsoft Azure Container Apps

This guide explains how to deploy the SecureFlow Next.js application to **Microsoft Azure Container Apps** using a production-ready container workflow.

It covers:
- Configuring Next.js standalone output
- Building an optimized multi-stage Docker image
- Pushing the container image to Azure Container Registry (ACR)
- Deploying the container image to Azure Container Apps (ACA)
- Configuring environment variables, networking, and scaling
- Setting up Prisma and database migrations in a containerized environment

---

## Overview

### Deployment Architecture
The deployment architecture consists of:
- **Client/Browser**: Communicates with the application via HTTPS external ingress.
- **Azure Container Apps**: Hosts the Next.js standalone application running inside a serverless container environment.
- **Azure Container Registry**: Stores and manages versioned Docker images.
- **PostgreSQL Database**: Managed relational database (such as Azure Database for PostgreSQL flexible server or a cloud database provider like Neon.tech) connected via Prisma 7.
- **External API Services**: Integrated services (Clerk Auth, Groq AI, Upstash Redis, Twilio, Cloudinary, etc.) configured via environment variables.

### Prerequisites
Before starting, ensure the following requirements are met:
- An active Azure subscription.
- The Azure CLI (`az`) installed and authenticated.
- Docker (or a compatible container tool) installed and running locally.
- Node.js 18+ and npm installed locally.
- A provisioned PostgreSQL database (v15+ recommended, with the `pgvector` extension enabled).

To verify your local environment setup, run:
```bash
az --version
docker --version
node --version
npm --version
```

If any tool is missing, install it before continuing.

---

## Docker Configuration

### Next.js Standalone Output
For production container deployments, it is highly recommended to use Next.js's native `standalone` output mode. This feature automatically traces your dependency graph and packages only the code files required for production execution, significantly reducing the final image size.

To enable standalone output, modify `next.config.ts` (or your existing Next.js configuration) to include the `output` property:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone", // Injects standalone packaging
  // Keep other existing configuration options unchanged...
};

export default nextConfig;
```

When you run a production build (`npm run build`), Next.js will generate a minimal server wrapper at `.next/standalone/server.js` instead of compiling the entire repository source code.

### Multi-Stage Dockerfile
To prevent bloating the production container with development dependencies, utilize a multi-stage Docker build. 

Create a file named `Dockerfile` in the project root with the following configuration:

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build the application
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client first to ensure typescript types compile correctly
RUN npx prisma generate
RUN npm run build

# Stage 3: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy necessary production artifacts
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080

CMD ["node", "server.js"]
```

Create a `.dockerignore` file in the project root to prevent copying local development state:
```text
node_modules
.next
out
build
.git
.env*.local
```

---

## Azure Container Registry

Azure Container Apps pulls container images from private or public registries. In this section, we will provision a private **Azure Container Registry (ACR)** and push our built image.

### Create Registry
Set variables for your resource group, registry name, and region:
```bash
# Variables
RESOURCE_GROUP="secureflow-rg"
LOCATION="eastus"
ACR_NAME="secureflowregistry" # Must be unique across Azure and contain only alphanumeric characters

# Create a Resource Group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create the Azure Container Registry
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true
```

### Login to Registry
Authenticate your local Docker client to the newly created Azure Container Registry:
```bash
az acr login --name $ACR_NAME
```

### Tag Docker Image
Build the container image locally and tag it with the login server address of your ACR:
```bash
# Retrieve the ACR Login Server url
ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer --output tsv)

# Build the local Docker image
docker build -t secureflow:latest .

# Tag the image for ACR
docker tag secureflow:latest $ACR_LOGIN_SERVER/secureflow:latest
```

### Push Docker Image
Upload the tagged image to your registry:
```bash
docker push $ACR_LOGIN_SERVER/secureflow:latest
```

---

## Azure Container Apps

Azure Container Apps provides serverless container hosting. It runs your container inside a **Container Apps Environment**, which acts as a secure boundary for networking and monitoring.

### Create Container Apps Environment
Before deploying a Container App, provision an environment:
```bash
ENVIRONMENT_NAME="secureflow-env"

az containerapp env create \
  --name $ENVIRONMENT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION
```

### Deploy the Application
Deploy the application image from your ACR. During deployment, configure the ingress to accept public traffic on port `8080` (matching the `PORT` set in our Dockerfile runner stage):
```bash
# Retrieve the admin credentials for registry integration
ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username --output tsv)
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query passwords[0].value --output tsv)

# Deploy to Azure Container Apps
az containerapp create \
  --name secureflow \
  --resource-group $RESOURCE_GROUP \
  --environment $ENVIRONMENT_NAME \
  --image $ACR_LOGIN_SERVER/secureflow:latest \
  --registry-server $ACR_LOGIN_SERVER \
  --registry-username $ACR_USERNAME \
  --registry-password $ACR_PASSWORD \
  --target-port 8080 \
  --ingress external \
  --query properties.configuration.ingress.fqdn
```

The command returns the fully qualified domain name (FQDN) where your app is publicly accessible.

### Configure Ingress
Azure Container Apps manages SSL certificates automatically. To review or update ingress configurations:
- Ensure **Ingress** is set to `Enabled`.
- **Traffic** is set to `Accepting traffic from anywhere` (External).
- **Target Port** must be configured to `8080`.

### Configure CPU/Memory
Allocate appropriate resources to the container app depending on traffic demands. To set the CPU to `0.5` cores and Memory to `1.0 Gi`:
```bash
az containerapp update \
  --name secureflow \
  --resource-group $RESOURCE_GROUP \
  --cpu 0.5 \
  --memory 1.0Gi
```

### Configure Scaling
Configure scaling rules to dynamic scale replicas based on HTTP concurrency or target loads:
```bash
# Configure horizontal scaling (min/max instances)
az containerapp update \
  --name secureflow \
  --resource-group $RESOURCE_GROUP \
  --min-replicas 1 \
  --max-replicas 10
```

*Note: Setting `--min-replicas 0` will allow the application to scale to zero to save costs, but will introduce brief cold start latency on initial requests.*

---

## Environment Variables

SecureFlow relies on environment variables for database connectivity, authentication, security, and third-party integrations. Sensitive variables must be stored as **Container App Secrets** first, then referenced as environment variables.

### Setting Secrets in Azure Container Apps
To securely define secrets in ACA:
```bash
az containerapp secret set \
  --name secureflow \
  --resource-group $RESOURCE_GROUP \
  --secrets \
    db-url="postgresql://<user>:<password>@<host>:5432/db?sslmode=require" \
    clerk-secret="sk_live_..." \
    groq-key="gq_..." \
    webhook-sec="whsec_..."
```

### Mapping Secrets and Variables to the Environment
Apply these values to the Container App runtime environment:
```bash
az containerapp update \
  --name secureflow \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    DATABASE_URL=secretref:db-url \
    CLERK_SECRET_KEY=secretref:clerk-secret \
    GROQ_API_KEY=secretref:groq-key \
    WEBHOOK_SECRET=secretref:webhook-sec \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_live_..." \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in" \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
```

### Complete Environment Variables Reference
Below is the exhaustive matrix of all environment variables supported by the repository. Configure these exactly as shown.

| Variable | Required | Context / Purpose |
| :--- | :---: | :--- |
| `DATABASE_URL` | ✅ Yes | Relational database connection string. Used by the Prisma client at runtime. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ Yes | Clerk publishable key for client-side authentication checks. |
| `CLERK_SECRET_KEY` | ✅ Yes | Clerk private key used for server-side auth validation. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | ✅ Yes | Local route to the authentication sign-in page (e.g. `/sign-in`). |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | ✅ Yes | Local route to the authentication sign-up page (e.g. `/sign-up`). |
| `WEBHOOK_SECRET` | ✅ Yes | Secret key used to verify incoming Clerk webhooks. |
| `GROQ_API_KEY` | ✅ Yes | API key for the Groq Cloud AI inference platform (powers chatbot queries). |
| `DIRECT_URL` | Optional | Database connection string bypassing pooling proxies, used strictly for Prisma migrations. |
| `CSRF_SECRET` | Optional | HMAC key used to sign client-side CSRF validation tokens. Falls back to `CLERK_SECRET_KEY` if unset. |
| `NEXT_PUBLIC_APP_URL` | Optional | The base domain URL of the deployed application (e.g. `https://<app-name>.<region>.azurecontainerapps.io`). |
| `COHERE_API_KEY` | Optional | Cohere API key to enable semantic memory vector generation and vector caching. |
| `PEXELS_API_KEY` | Optional | API key used to fetch and cache remote stock workplace photographs. |
| `UNSPLASH_ACCESS_KEY` | Optional | Client-side/Server-side access token for Unsplash image indexing. |
| `CLOUDINARY_CLOUD_NAME` | Optional | Cloudinary cloud identifier (used for image/avatar uploading). |
| `CLOUDINARY_API_KEY` | Optional | Cloudinary upload API key. |
| `CLOUDINARY_API_SECRET` | Optional | Cloudinary upload API secret token. |
| `SMTP_HOST` | Optional | Outbound SMTP email dispatch hostname (e.g., `smtp.gmail.com`). |
| `SMTP_PORT` | Optional | SMTP connection port (e.g., `587`). |
| `SMTP_USER` | Optional | SMTP authentication email/username. |
| `SMTP_PASS` | Optional | SMTP authentication password/secret. |
| `SMTP_SECURE` | Optional | Use secure SMTP connection flag (`true` or `false`). |
| `UPSTASH_REDIS_REST_URL` | Optional | REST endpoint URL to connect to the Upstash Redis instance (for rate-limiting and telemetry tracking). |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash Redis connection token. |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account credentials for SMS/Reminders dispatch. |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio account authorization token. |
| `TWILIO_PHONE_NUMBER` | Optional | Registered Twilio telephone number. |
| `CRON_SECRET` | Optional | Bearer authentication token used to secure the `/api/cron/reminders` endpoint. |
| `WORKER_SECRET` | Optional | Authentication secret verification token used for webhook worker endpoints. |
| `SVIX_TOKEN` | Optional | Svix developer key for webhook dispatching and log validation. |

---

## Database Configuration

SecureFlow uses Prisma 7 configured with PostgreSQL. 

### Prisma 7 Driver Adapter Setup
Because Prisma 7 in this repository uses a driver-based adapter configuration, the Prisma Client relies on connection pooling inside your Next.js process utilizing `@prisma/adapter-pg` and the Node-Postgres `pg` driver:

```typescript
// Runtime database pool initialization inside src/lib/prisma.ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
return new PrismaClient({ adapter });
```

### Running Schema Migrations
Prisma migrations write changes to database system tables and cannot execute dynamically within a serverless read-only container lifecycle at startup. Therefore, you should apply migrations **before** the container deployment triggers.

Run the following command from an environment with direct network access to your PostgreSQL database (using your `DATABASE_URL` or `DIRECT_URL` for migration scripts):

```bash
# Push database migrations to the Azure PostgreSQL database
npx prisma migrate deploy
```

If you need to seed test workspaces and rating configurations, run:
```bash
# Seed initial database rows
npx prisma db seed
```

---

## Updating Deployments

When you push new changes to the repository, update your active Container Apps deployment by repeating the image compilation and revision update steps:

```bash
# 1. Rebuild and tag the new image
docker build -t secureflow:latest .
docker tag secureflow:latest $ACR_LOGIN_SERVER/secureflow:latest

# 2. Push to Azure Container Registry
docker push $ACR_LOGIN_SERVER/secureflow:latest

# 3. Trigger a container revision reload in Azure Container Apps
az containerapp update \
  --name secureflow \
  --resource-group $RESOURCE_GROUP \
  --image $ACR_LOGIN_SERVER/secureflow:latest
```

Azure Container Apps will provision the new container version, run health checks, and execute a zero-downtime rolling switchover.

---

## Troubleshooting

### Database Connection Failures
- **Error**: `PrismaClientInitializationError: WebAssembly.instantiate()...` or pool timeout.
- **Cause**: Egress traffic from the Azure Container App environment is blocked by the database's firewall rules.
- **Solution**: Whitelist the Azure Container App Environment outbound IP addresses in your PostgreSQL instance firewall settings, or host both services inside the same Azure Virtual Network (VNet).

### Clerk Authentication Redirect Loops
- **Error**: Redirection issues when clicking signup/login links.
- **Cause**: Missing or mismatched `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` or `NEXT_PUBLIC_APP_URL`.
- **Solution**: Confirm that both are supplied in the Container App environment variable configurations.

### Container Crash Loop at Startup
- **Error**: Container starts and exits with a crash status.
- **Cause**: Target port mismatch. Container Apps ingress redirects traffic to port `80` by default if not set.
- **Solution**: Ensure your deploy command defines `--target-port 8080` to align with the Next.js port specified in the runner stage. Check startup logs using:
  ```bash
  az containerapp logs show \
    --name secureflow \
    --resource-group $RESOURCE_GROUP
  ```

### Static File Assets Missing (404)
- **Error**: Font files, local styles, or images fail to resolve.
- **Cause**: Multi-stage runner stage is missing static/public folders.
- **Solution**: Verify your `Dockerfile` has instructions copying the `.next/static` folder to `.next/static` and the `public` folder to `public`.

---

## References

- [Azure Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [Next.js Standalone Deployment Guide](https://nextjs.org/docs/pages/building-your-application/deploying#docker-image)
- [Prisma 7 Client Reference Guide](https://www.prisma.io/docs/orm/reference/prisma-client-reference)
