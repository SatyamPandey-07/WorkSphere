# Vercel Enterprise Deployment Guide

## Overview

This guide explains how to deploy WorkSphere using Vercel Enterprise. It focuses on common production deployment tasks such as configuring custom domains, managing environment variables across different environments, and applying caching strategies for better performance.

The goal is to provide a simple deployment reference that teams can follow when moving the application from development to production.

---

# Prerequisites

Before creating a deployment, make sure the following requirements are met:

- A Vercel Enterprise account with access to the project.
- The WorkSphere repository connected to your GitHub organization.
- All required production environment variables available.
- Access to your DNS provider if a custom domain will be used.
- A production-ready database and any third-party service credentials.

---

# Creating a New Project

1. Sign in to the Vercel Dashboard.
2. Click **Add New Project**.
3. Import the WorkSphere GitHub repository.
4. Select the production branch (usually `main`).
5. Review the detected Next.js configuration before deploying.

Vercel automatically recognizes Next.js projects, so no additional framework configuration is normally required.

---

# Recommended Build Configuration

The default build settings are suitable for this project.

| Setting | Recommended Value |
| -------- | ----------------- |
| Framework Preset | Next.js |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | Default |

If custom build commands are introduced in the future, update these settings accordingly.

---

# Environment Variables

WorkSphere relies on several external services, so environment variables should be managed separately for each deployment environment.

| Environment | Purpose |
| ------------ | ------- |
| Development | Local development |
| Preview | Pull Request deployments |
| Production | Live application |

Typical variables include:

```text
DATABASE_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
OPENAI_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### Recommendations

- Never commit secrets to the repository.
- Use different credentials for Preview and Production deployments.
- Rotate sensitive credentials periodically.
- Restart deployments after updating environment variables so changes are applied correctly.

---

# Custom Domains

Vercel Enterprise makes it easy to connect one or more custom domains to your project.

## Adding a Custom Domain

1. Open your project in the Vercel Dashboard.
2. Navigate to **Settings → Domains**.
3. Click **Add Domain**.
4. Enter the domain or subdomain you want to use.
5. Update the required DNS records with your domain provider.
6. Wait for the verification process to complete.

Example domains:

```text
example.com
www.example.com
app.example.com
```

Once the DNS records propagate, Vercel automatically verifies ownership and activates the domain.

---

# SSL Certificates

SSL certificates are automatically provisioned and renewed by Vercel after a domain has been verified.

If HTTPS is not enabled immediately:

- Verify that all DNS records are configured correctly.
- Remove any conflicting DNS entries.
- Allow enough time for DNS propagation.
- Recheck the domain status in the Vercel Dashboard.

---

# Edge Caching

Proper caching improves application performance and reduces response times.

For static assets such as images, fonts, and compiled JavaScript files, long-lived caching is recommended.

Example:

```http
Cache-Control: public, max-age=31536000, immutable
```

For dynamic API responses, shorter cache durations provide a good balance between performance and fresh data.

Example:

```http
Cache-Control: public, s-maxage=60, stale-while-revalidate=300
```

Choose cache durations based on how frequently your content changes.

---

# Preview Deployments

Every Pull Request automatically generates a Preview Deployment.

Preview deployments allow teams to:

- Review new features before merging.
- Perform QA testing.
- Validate UI changes.
- Share working previews with reviewers and stakeholders.

Keeping production and preview environments isolated helps reduce deployment risks.

---

# Production Deployment

Before promoting a deployment to production, verify the following:

- All required environment variables are configured.
- The application builds successfully.
- Lint checks pass.
- Automated tests complete successfully.
- The Preview Deployment has been reviewed.

Once these checks are complete, promote the deployment through the Vercel Dashboard or your team's release workflow.

---

# Troubleshooting

## Build Failures

If the deployment fails during the build stage:

- Verify all required environment variables.
- Check dependency versions.
- Review the build logs for detailed error messages.
- Confirm the Node.js version matches the project's requirements.

---

## Domain Verification Problems

If a custom domain cannot be verified:

- Confirm that DNS records match the values provided by Vercel.
- Remove conflicting records.
- Wait for DNS propagation before retrying.

---

## Environment Variable Issues

If the application behaves differently between environments:

- Ensure each environment uses the correct variable values.
- Redeploy the application after updating variables.
- Avoid reusing production credentials in preview deployments.

---

# Best Practices

- Keep production credentials secure and never commit secrets to the repository.
- Use Preview Deployments to validate changes before production releases.
- Enable branch protection for the production branch.
- Review deployment logs after every release.
- Monitor application performance after deployment.
- Rotate API keys and secrets periodically.
- Document any deployment-specific changes for future contributors.

---

# Additional Resources

- Vercel Dashboard documentation
- Next.js deployment documentation
- Project environment variable guide (`docs/ENV_VARS.md`)
- AWS/GCP deployment guide (`docs/DEPLOYMENT_AWS_GCP.md`)

##