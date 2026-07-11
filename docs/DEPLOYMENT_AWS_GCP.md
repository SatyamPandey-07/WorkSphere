# Deployment Guide for AWS ECS & Google Cloud Run

## Overview

> **Note**
>
> At the time of writing, WorkSphere's documented deployment workflow is focused on **Vercel**, as described in the project README. This guide provides additional deployment guidance for teams that wish to self-host the application on cloud platforms such as **Amazon Web Services (AWS)** or **Google Cloud Platform (GCP)**.
>
> The containerization recommendations included in this document are **optional deployment strategies** and do **not** represent the current repository configuration. The repository does not currently include a Dockerfile, Docker Compose configuration, or a Next.js standalone build setup.

As WorkSphere grows, different organizations may choose deployment platforms that better match their infrastructure, operational requirements, or cloud ecosystem. While Vercel provides an excellent deployment experience for many Next.js applications, production environments often require additional flexibility, such as running services inside managed containers, integrating with existing cloud infrastructure, or deploying alongside private databases and internal services.

This document describes a recommended deployment approach for hosting WorkSphere on **AWS Elastic Container Service (ECS)** and **Google Cloud Run** while remaining aligned with the current project architecture. It explains the existing build process, required environment variables, database considerations, production preparation, and optional containerization practices that contributors may adopt when deploying outside of Vercel.

Rather than replacing the existing deployment documentation, this guide complements it by providing cloud-specific recommendations for alternative hosting environments.

---

# Objectives

This guide is intended to help contributors and deployment engineers understand how the current WorkSphere application can be prepared for production deployments on alternative cloud platforms.

Specifically, this document aims to:

- Explain the current production build workflow used by the project.
- Identify the environment variables required during deployment.
- Document deployment considerations for AWS ECS and Google Cloud Run.
- Describe database configuration using PostgreSQL and Prisma.
- Recommend optional containerization practices for cloud deployments.
- Provide production readiness and troubleshooting guidance.
- Keep deployment recommendations aligned with the current repository structure.

The recommendations in this guide are based on the existing project architecture and intentionally distinguish between the application's current implementation and optional deployment enhancements.

---

# Scope

This guide focuses on deployment-related topics for self-hosted environments, including:

- Production build preparation
- Environment variable configuration
- Prisma database connectivity
- AWS Elastic Container Service (ECS)
- Google Cloud Run
- Production deployment checklist
- Optional Docker-based containerization
- Operational best practices

This document does **not** replace the existing Vercel deployment instructions provided in the README. Instead, it serves as supplementary documentation for teams deploying WorkSphere on their own cloud infrastructure.

---

# Current Deployment Architecture

Before deploying WorkSphere to AWS or GCP, contributors should understand the current deployment model used by the repository.

The application is built as a standard **Next.js** project and currently relies on the default production workflow provided by Next.js.

The existing repository includes:

- Next.js production builds using `next build`
- Production server startup using `next start`
- Prisma ORM with PostgreSQL
- Environment variable configuration through `.env.local`
- Continuous Integration using GitHub Actions
- Vercel deployment guidance documented in the project README

The repository **does not currently include**:

- Dockerfile
- Docker Compose configuration
- Next.js standalone output configuration
- Cloud-specific deployment manifests for AWS or GCP

For organizations deploying outside of Vercel, optional containerization can be introduced without changing the existing application architecture.

# Current Build Workflow

The current project uses the standard Next.js production workflow together with Prisma Client generation.

The production lifecycle defined in `package.json` is:

1. Install project dependencies.
2. Generate the Prisma Client.
3. Build the Next.js application.
4. Start the production server.

Current build script:

```bash
npm run build
```

Current start script:

```bash
npm run start
```

The build script internally executes:

```text
prisma generate
↓
next build
```

This ensures that the Prisma Client is generated before the Next.js application is compiled.

---

# Production Prerequisites

Before deploying WorkSphere to any production environment, verify that the following prerequisites are satisfied.

## Runtime Requirements

Recommended production environment:

| Component | Recommendation |
|-----------|----------------|
| Node.js | 20.x LTS or newer |
| Package Manager | npm |
| Database | PostgreSQL |
| Prisma | Prisma 7 |
| Operating System | Linux (recommended) |

The application should be built using the same Node.js version across local development, CI, and production to minimize unexpected runtime differences.

---

## Required Environment Variables

WorkSphere depends on several environment variables for authentication, AI integrations, database access, analytics, media uploads, and email functionality.

Before deployment, ensure the required variables are available within the hosting platform.

Core variables include:

```text
DATABASE_URL

GROQ_API_KEY
COHERE_API_KEY

WEBHOOK_SECRET

SMTP_USER
SMTP_PASS
SMTP_HOST
SMTP_PORT

CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET

PEXELS_API_KEY

UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN

NEXT_PUBLIC_APP_URL
```

Some deployment environments may also require platform-specific variables depending on the selected authentication provider or hosting platform.

Sensitive credentials should never be committed to the repository.

Instead, configure them using the cloud provider's secure environment variable management system.

---

# Database Configuration

WorkSphere uses **Prisma ORM** with **PostgreSQL** as its primary database layer.

The Prisma configuration reads the database connection string from the `DATABASE_URL` environment variable.

Typical connection string:

```text
DATABASE_URL="postgresql://username:password@host:5432/database?sslmode=require"
```

Before starting the application in production:

- Provision a PostgreSQL database.
- Configure the `DATABASE_URL` environment variable.
- Run Prisma Client generation during the build process.
- Apply database migrations if required by the deployment workflow.
- Verify that the application can successfully establish a database connection.

Cloud-hosted PostgreSQL providers such as Amazon RDS, Neon, Supabase, or Cloud SQL may all be suitable depending on the deployment environment.

---

# Continuous Integration

The repository already includes a GitHub Actions workflow that validates production builds.

The current CI pipeline performs tasks such as:

- Installing project dependencies
- Generating the Prisma Client
- Running ESLint
- Building the Next.js application
- Executing unit tests

Keeping deployment environments consistent with the CI configuration helps reduce deployment-specific issues and improves build reproducibility.

# Optional Containerization

> **Recommendation**
>
> The current WorkSphere repository does not include a Dockerfile, Docker Compose configuration, or a Next.js standalone build setup. The following approach is provided as an optional recommendation for teams that wish to deploy the application using containers on platforms such as AWS ECS or Google Cloud Run.

Containerization provides a consistent runtime environment across development, testing, and production. Packaging the application as a container simplifies deployments, improves portability, and enables integration with managed container orchestration services.

Typical advantages include:

- Consistent deployment environments
- Simplified dependency management
- Easier horizontal scaling
- Improved CI/CD integration
- Platform-independent deployments
- Predictable production builds

For production environments, contributors may choose to introduce a multi-stage Docker build to reduce image size and separate build-time dependencies from the runtime image.

---

# Recommended Multi-Stage Docker Build

A production-ready Docker workflow typically consists of multiple build stages:

1. Install project dependencies.
2. Generate the Prisma Client.
3. Build the Next.js application.
4. Copy only the required production artifacts into a lightweight runtime image.
5. Start the production server.

A recommended production flow is illustrated below.

```text
Build Stage
─────────────────────────────
Install Dependencies
        │
        ▼
Prisma Generate
        │
        ▼
Next.js Build
        │
        ▼
Copy Production Assets
        │
        ▼
Runtime Container
```

Using a multi-stage build minimizes the final container size by excluding development dependencies from the runtime image.

If container support is added in the future, the Docker configuration should remain synchronized with the project's existing build process:

```text
npm install
↓
prisma generate
↓
next build
↓
next start
```

This keeps containerized deployments aligned with the current production workflow.

---

# Example Docker Workflow

The repository does not currently include a production-ready `Dockerfile`. If container support is introduced in the future, the following commands illustrate a typical workflow for building and running WorkSphere inside a Docker container.

## Build the Docker Image

```bash
docker build -t worksphere:latest .
```

This command builds the production image using the Dockerfile located in the project root.

## Run the Container

```bash
docker run \
  -p 3000:3000 \
  --env-file .env.local \
  worksphere:latest
```

This starts the application inside a container while loading environment variables from the local environment file.

## Verify the Container

After starting the container, verify the following:

- The application is accessible at `http://localhost:3000`.
- Prisma successfully connects to the configured PostgreSQL database.
- Static assets load correctly.
- No runtime errors appear in the application logs.

To inspect the running container logs:

```bash
docker logs <container-id>
```

This verification step helps ensure that the container behaves the same way as the local development environment before deploying to AWS ECS or Google Cloud Run.

---

# Deploying to AWS Elastic Container Service (ECS)

Amazon ECS is a managed container orchestration service that allows WorkSphere to run as scalable containerized workloads without requiring direct server management.

A typical deployment architecture consists of:

```text
Users
   │
   ▼
Application Load Balancer
   │
   ▼
Amazon ECS Service
   │
   ▼
ECS Tasks (WorkSphere Containers)
   │
   ▼
Amazon RDS PostgreSQL
```

Supporting services such as CloudWatch Logs, IAM roles, Secrets Manager, and Auto Scaling can be integrated depending on operational requirements.

---

## Deployment Workflow

A typical deployment to ECS follows these high-level steps:

1. Build the production container image.
2. Push the image to Amazon Elastic Container Registry (ECR).
3. Create an ECS Task Definition.
4. Configure required environment variables.
5. Create an ECS Service.
6. Attach an Application Load Balancer.
7. Connect the application to an Amazon RDS PostgreSQL instance.
8. Verify application health after deployment.

Although the exact infrastructure varies between organizations, this workflow represents a common production deployment pattern for containerized Next.js applications.

---

## Amazon RDS Integration

For production deployments, PostgreSQL can be hosted using Amazon RDS.

Recommended considerations include:

- Store the connection string securely.
- Restrict database access using security groups.
- Enable automated backups.
- Enable Multi-AZ deployments when high availability is required.
- Use SSL-enabled database connections.
- Monitor database performance through CloudWatch.

The application's `DATABASE_URL` should reference the RDS instance and be provided through the ECS task configuration or a managed secrets service.

---

## Managing Environment Variables

Sensitive configuration should never be baked into container images.

Instead, environment variables should be supplied during deployment using AWS-managed services such as:

- Amazon ECS Task Definitions
- AWS Secrets Manager
- AWS Systems Manager Parameter Store

This approach improves security while simplifying configuration changes across environments.

---

## Publishing Images to Amazon ECR

A common deployment workflow for Amazon ECS involves pushing the application image to Amazon Elastic Container Registry (ECR) before creating or updating an ECS service.

Example commands:

```bash
docker build -t worksphere:latest .

docker tag worksphere:latest \
<account-id>.dkr.ecr.<region>.amazonaws.com/worksphere:latest

docker push \
<account-id>.dkr.ecr.<region>.amazonaws.com/worksphere:latest
```

Replace:

- `<account-id>` with your AWS account ID.
- `<region>` with the AWS region where your ECR repository is hosted.

After the image is uploaded successfully, reference it from your ECS Task Definition to deploy the latest application version.

## Scaling Considerations

As application traffic grows, ECS can scale container instances horizontally.

Common production practices include:

- Multiple running tasks
- Load balancing across tasks
- Health checks
- Automatic task replacement
- CPU and memory based auto scaling

These features improve application availability while reducing operational overhead.

# Deploying to Google Cloud Run

Google Cloud Run provides a fully managed serverless platform for running containerized applications without managing virtual machines or Kubernetes clusters.

It automatically scales instances based on incoming traffic and integrates with other Google Cloud services such as Cloud SQL, Secret Manager, Cloud Build, and Cloud Monitoring.

A typical deployment architecture is shown below.

```text
Users
   │
   ▼
Google Cloud Load Balancer
   │
   ▼
Cloud Run Service
   │
   ▼
WorkSphere Container
   │
   ▼
Cloud SQL (PostgreSQL)
```

This architecture allows the application to scale automatically while keeping operational overhead low.

---

## Deployment Workflow

A typical Cloud Run deployment consists of the following steps:

1. Build the production container image.
2. Push the image to Google Artifact Registry.
3. Deploy the container to Cloud Run.
4. Configure environment variables.
5. Connect the application to Cloud SQL (PostgreSQL).
6. Verify application health and accessibility.

The exact infrastructure may differ depending on organizational requirements, but these steps represent a common production deployment workflow.

---

## Deploying with Google Cloud CLI

Once the production container image is ready, it can be deployed to Cloud Run using the Google Cloud CLI.

Example commands:

```bash
gcloud builds submit \
  --tag gcr.io/PROJECT_ID/worksphere

gcloud run deploy worksphere \
  --image gcr.io/PROJECT_ID/worksphere \
  --platform managed \
  --region us-central1
```

Replace:

- `PROJECT_ID` with your Google Cloud project ID.
- `us-central1` with the preferred deployment region if required.

Before deployment, ensure that:

- Cloud Run API is enabled.
- Artifact Registry is configured.
- Required environment variables are supplied through Cloud Run or Secret Manager.
- The application can access the configured PostgreSQL database.

---

## Cloud SQL Integration

Cloud SQL provides a managed PostgreSQL service suitable for hosting WorkSphere's database.

Recommended practices include:

- Store database credentials securely.
- Enable SSL connections.
- Configure automated backups.
- Restrict database access using IAM and networking rules.
- Monitor database performance regularly.

The application's `DATABASE_URL` should reference the Cloud SQL instance and be provided through Cloud Run environment variables or Secret Manager.

---

## Managing Environment Variables

Cloud Run allows sensitive configuration to be supplied during deployment instead of embedding credentials inside the application.

Typical configuration includes:

- Database connection string
- AI provider API keys
- Cloudinary credentials
- SMTP configuration
- Redis credentials
- Authentication secrets

Using Secret Manager is recommended for production deployments to improve security and simplify credential rotation.

---

# Production Readiness Checklist

Before deploying WorkSphere to AWS or Google Cloud Platform, verify the following:

- Production environment variables are configured.
- PostgreSQL is accessible from the application.
- Prisma Client is generated successfully.
- Application builds successfully using `npm run build`.
- Application starts successfully using `npm run start`.
- Required external services are reachable.
- HTTPS is enabled.
- Logs are available for monitoring.
- Health checks are configured.
- Sensitive credentials are stored securely.

Completing these checks before deployment helps reduce runtime failures and improves deployment reliability.

---

# Troubleshooting

## Build Failures

Possible causes include:

- Missing environment variables
- Dependency installation failures
- Prisma generation errors
- TypeScript compilation errors

Verify the build locally before deploying to production.

---

## Database Connection Errors

If the application cannot connect to PostgreSQL:

- Verify the `DATABASE_URL`.
- Confirm database availability.
- Check firewall or networking rules.
- Ensure SSL settings match the database configuration.

---

## Missing Environment Variables

Many runtime failures are caused by missing configuration.

Before deployment, verify that all required environment variables are available within the target hosting platform.

Avoid hardcoding secrets inside application source code or container images.

---

## Runtime Errors

If the application starts but behaves unexpectedly:

- Review application logs.
- Confirm API credentials are valid.
- Verify external services are reachable.
- Check database connectivity.
- Ensure the application was built using the expected Node.js version.

---

# Post Deployment Verification

After deploying WorkSphere to AWS ECS or Google Cloud Run, perform a few validation checks before making the application available to end users.

## Application Health

Verify that:

- The application starts without runtime errors.
- The homepage loads successfully.
- API routes return successful responses.
- Static assets such as images, fonts, and JavaScript files load correctly.

## Database Connectivity

Confirm that:

- Prisma establishes a successful connection to PostgreSQL.
- Required database queries execute without errors.
- Connection credentials are loaded from the deployment environment.

## Environment Variables

Ensure that all required environment variables are available in the deployment platform.

Common examples include:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `GROQ_API_KEY`
- `CLOUDINARY_API_KEY`
- `UPSTASH_REDIS_REST_URL`

Missing environment variables are one of the most common causes of deployment failures.

## Monitoring

After deployment, review:

- Application logs
- Container logs
- Database logs
- Cloud platform monitoring dashboards

Monitoring helps identify configuration issues before they affect users.

---

# Best Practices

When deploying WorkSphere outside of Vercel, contributors are encouraged to follow these practices:

- Keep production and development environments as consistent as possible.
- Store secrets using the cloud provider's managed secret service.
- Monitor application logs and resource usage.
- Enable automated database backups.
- Apply updates through repeatable CI/CD pipelines.
- Keep dependencies up to date.
- Test deployments in a staging environment before production.
- Review infrastructure configuration regularly.

Following these practices helps improve deployment reliability, maintainability, and operational security.

---

# Future Improvements

As WorkSphere evolves, future deployment enhancements may include:

- Official Dockerfile
- `.dockerignore` configuration
- Docker Compose support for local development
- Next.js standalone output configuration
- Infrastructure-as-Code templates
- Automated container publishing
- Deployment pipelines for AWS and GCP
- Kubernetes deployment manifests
- Production monitoring and observability documentation

These enhancements can be introduced without changing the application's existing deployment workflow and would provide a stronger foundation for self-hosted production environments.

---

# Conclusion

WorkSphere is currently documented primarily for deployment on Vercel, but its existing architecture can also support deployments on managed cloud platforms such as AWS ECS and Google Cloud Run with appropriate infrastructure configuration.

This guide documents recommended deployment practices that align with the repository's current build process while clearly distinguishing optional containerization recommendations from the project's existing implementation. As the project evolves, these recommendations can be expanded to include official container support, automated deployment workflows, and additional cloud providers.