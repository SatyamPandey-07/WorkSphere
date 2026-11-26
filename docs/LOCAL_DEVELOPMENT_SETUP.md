# Local Development Setup Guide

This guide walks you through setting up **PostgreSQL** and **Redis** locally for WorkSphere using Docker Compose—no cloud credentials or external database accounts required.

---

## Prerequisites

Ensure the following tools are installed on your machine:

- **Node.js** (v20 or later) & **npm**
- **Docker Desktop** (macOS / Windows) or **Docker Engine + Docker Compose** (Linux)
- **Git**

---

## Step 1: Start PostgreSQL and Redis via Docker Compose

From the root of the repository, spin up the local PostgreSQL and Redis containers in detached mode:

```bash
docker-compose up -d postgres redis
```
