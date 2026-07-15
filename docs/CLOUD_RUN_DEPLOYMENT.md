# Deploying Next.js Applications to Google Cloud Run

This guide explains how to deploy the WorkSphere Next.js application to **Google Cloud Run** using a production-ready container workflow.

It covers:

- Building an optimized Docker image with a multi-stage build
- Publishing container images to Google Artifact Registry
- Deploying the application to Cloud Run
- Managing sensitive environment variables with Google Secret Manager
- Production recommendations and common troubleshooting steps

This deployment approach is suitable for scalable, serverless hosting while keeping build artifacts small and deployment workflows easy to maintain.

---

# Prerequisites

Before starting, make sure the following requirements are met:

- A Google Cloud project with billing enabled
- The Google Cloud CLI (`gcloud`) installed and authenticated
- Docker installed and running locally
- A Google Cloud Run service account with the required permissions
- An Artifact Registry repository (or permission to create one)
- A working Next.js application that builds successfully

You can verify your local setup by running:

```bash
gcloud --version
docker --version
node --version
npm --version
```

If any of these commands are unavailable, install the required tooling before continuing.

---

# Enable Required Google Cloud APIs

Before building and deploying the application, enable the required Google Cloud services for your project.

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

These services provide:

| Service | Purpose |
|----------|---------|
| Cloud Run | Hosts the application container |
| Artifact Registry | Stores Docker images |
| Cloud Build | Builds container images (optional but recommended) |
| Secret Manager | Securely stores sensitive configuration values |

---

# Configure Next.js Standalone Output

For production deployments, Next.js recommends using the standalone output mode when deploying with Docker. This creates a minimal production bundle that includes only the files required to run the application.

Add the following option to `next.config.ts` before creating a production build:

```ts
const nextConfig = {
  output: "standalone",
};
```

If your project already contains other configuration options, simply add the `output` property without removing the existing configuration.

After updating the configuration, generate a production build:

```bash
npm run build
```

A successful build will create the `.next/standalone` directory, which will be used by the Docker image in the next step.

---

# Create a Multi-Stage Dockerfile

Using a multi-stage Docker build helps reduce the final image size by excluding development dependencies and unnecessary build files from the production image.

Create a file named `Dockerfile` in the project root with the following configuration:

```dockerfile
# Install dependencies
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Build the application
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080

CMD ["node", "server.js"]
```

### Why use a multi-stage build?

- Keeps the production image smaller by excluding build-time dependencies.
- Reduces deployment time and container startup overhead.
- Produces a cleaner runtime environment with only the files required to serve the application.
- Aligns with the recommended deployment approach for Next.js standalone builds.

---

# Publish the Container Image to Artifact Registry

Google Cloud Run pulls container images from **Artifact Registry**. Before deploying the application, create a Docker repository and push your production image.

## Create an Artifact Registry Repository

If you do not already have a Docker repository, create one:

```bash
gcloud artifacts repositories create worksphere \
  --repository-format=docker \
  --location=us-central1 \
  --description="Docker images for WorkSphere"
```

You only need to create the repository once.

---

## Configure Docker Authentication

Allow Docker to authenticate with Artifact Registry:

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

This updates Docker's authentication configuration so images can be pushed to your Google Cloud project.

---

## Build the Docker Image

Replace `PROJECT_ID` with your Google Cloud project ID before running the command.

```bash
docker build \
  -t us-central1-docker.pkg.dev/PROJECT_ID/worksphere/worksphere:latest .
```

Once the build completes successfully, verify that the image exists locally:

```bash
docker images
```

---

## Push the Image

Upload the image to Artifact Registry:

```bash
docker push \
  us-central1-docker.pkg.dev/PROJECT_ID/worksphere/worksphere:latest
```

After the upload finishes, the image is ready to be deployed to Cloud Run.

---

# Deploy to Google Cloud Run

Once the container image has been pushed to Artifact Registry, deploy it to Cloud Run.

Replace `PROJECT_ID` with your Google Cloud project ID before running the command.

```bash
gcloud run deploy worksphere \
  --image us-central1-docker.pkg.dev/PROJECT_ID/worksphere/worksphere:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

Cloud Run will create a new revision and provide a public service URL after the deployment completes successfully.

You can view all deployed services at any time by running:

```bash
gcloud run services list
```

---

# Manage Secrets with Google Secret Manager

Sensitive values such as API keys, database credentials, and authentication secrets should not be stored in the repository or hardcoded into the Docker image.

Create a secret by running:

```bash
echo "postgresql://..." | gcloud secrets create DATABASE_URL --data-file=-
```

If the secret already exists, create a new version instead:

```bash
echo "postgresql://..." | gcloud secrets versions add DATABASE_URL --data-file=-
```

Attach the secret when deploying the application:

```bash
gcloud run deploy worksphere \
  --image us-central1-docker.pkg.dev/PROJECT_ID/worksphere/worksphere:latest \
  --update-secrets DATABASE_URL=DATABASE_URL:latest
```

You can attach additional secrets in the same way for values such as:

- `DATABASE_URL`
- `CLERK_SECRET_KEY`
- `GROQ_API_KEY`
- `SMTP_PASSWORD`

Using Secret Manager keeps sensitive configuration separate from the application source code and makes secret rotation easier without rebuilding the container.

---

# Production Recommendations

The following practices can help improve reliability and performance in production deployments:

- Use the standalone Next.js output to reduce the final container size.
- Store sensitive configuration values in Google Secret Manager instead of environment files.
- Use Artifact Registry to manage container image versions.
- Keep Docker images lightweight by using multi-stage builds.
- Enable Cloud Logging and Cloud Monitoring to simplify debugging and performance analysis.
- Review Cloud Run CPU and memory settings based on your application's workload.
- Regularly update dependencies and rebuild container images to receive security updates.

---

# Troubleshooting

## Build fails during Docker image creation

- Verify that all project dependencies are installed.
- Run `npm run build` locally to identify build errors before creating the container image.
- Ensure `output: "standalone"` is configured in `next.config.ts`.

> **Note:** The current project configuration may not include `output: "standalone"`. Enable this option before creating a production Docker build for Cloud Run.

---

## Container fails to start

- Confirm that all required environment variables and secrets are available.
- Verify that the application starts successfully outside the container.
- Review the Cloud Run logs for startup errors.

---

## Unable to push images to Artifact Registry

- Confirm that Docker authentication has been configured.

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

- Verify that your account has permission to push images to the selected Artifact Registry repository.

---

## Secret is not available at runtime

- Check that the secret exists in Google Secret Manager.
- Verify that the latest secret version is attached during deployment.
- Confirm that the Cloud Run service account has permission to access the secret.

---

# Useful Commands

List deployed Cloud Run services:

```bash
gcloud run services list
```

View recent application logs:

```bash
gcloud run logs read worksphere
```

List available revisions:

```bash
gcloud run revisions list
```

List local Docker images:

```bash
docker images
```

List running Docker containers:

```bash
docker ps
```