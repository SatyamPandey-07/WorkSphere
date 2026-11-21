# 🌳 Git Worktree & Branch Isolation Guide for Contributors

This guide provides a beginner-friendly walkthrough on using **`git worktree`** for WorkSphere development. It explains how to work on multiple branches simultaneously without stashing, switching branches, or managing multiple repository clones.

---

## 📋 Table of Contents

- [1. What is Git Worktree?](#1-what-is-git-worktree)
  - [Why Not `git stash` or `git switch`?](#why-not-git-stash-or-git-switch)
  - [Why Not Multiple `git clone` Copies?](#why-not-multiple-git-clone-copies)
- [2. Recommended Folder Structure](#2-recommended-folder-structure)
- [3. Step-by-Step Commands](#3-step-by-step-commands)
  - [3.1 Creating a Worktree for a New Branch](#31-creating-a-worktree-for-a-new-branch)
  - [3.2 Creating a Worktree for an Existing Branch](#32-creating-a-worktree-for-an-existing-branch)
  - [3.3 Listing Active Worktrees](#33-listing-active-worktrees)
  - [3.4 Removing a Worktree](#34-removing-a-worktree)
  - [3.5 Pruning Orphaned Worktree Metadata](#35-pruning-orphaned-worktree-metadata)
  - [3.6 Locking and Unlocking Worktrees](#36-locking-and-unlocking-worktrees)
- [4. Complete Contributor Lifecycle Walkthrough](#4-complete-contributor-lifecycle-walkthrough)
- [5. Common Pitfalls & WorkSphere Nuances](#5-common-pitfalls--worksphere-nuances)
  - [Pitfall 1: Linked node_modules and Dependency Collisions](#pitfall-1-linked-node_modules-and-dependency-collisions)
  - [Pitfall 2: Missing Environment Files (.env.local)](#pitfall-2-missing-environment-files-envlocal)
  - [Pitfall 3: Prisma Client Generation](#pitfall-3-prisma-client-generation)
  - [Pitfall 4: Dev Server Port Collisions](#pitfall-4-dev-server-port-collisions)
  - [Pitfall 5: Branch Already Checked Out Error](#pitfall-5-branch-already-checked-out-error)
  - [Pitfall 6: Deleting Folders Manually Without git worktree remove](#pitfall-6-deleting-folders-manually-without-git-worktree-remove)
  - [Pitfall 7: Git Hooks and Husky Execution on Windows](#pitfall-7-git-hooks-and-husky-execution-on-windows)
- [6. Quick Reference Cheat Sheet](#6-quick-reference-cheat-sheet)

---

## 1. What is Git Worktree?

In standard Git usage, a repository directory contains exactly one active working branch checked out at any given time.

**`git worktree`** allows you to attach **multiple independent working directories** to a single repository. Each worktree has its own dedicated directory and checked-out branch, while sharing the same underlying Git history, object database, remote configurations (`origin`, `upstream`), and stashes located in the primary `.git` directory.

```
                    ┌─────────────────────────┐
                    │   Primary Repository    │
                    │      WorkSphere/        │
                    │     (.git database)     │
                    └───────────┬─────────────┘
                                │
       ┌────────────────────────┼────────────────────────┐
       ▼                        ▼                        ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  worktree 1  │         │  worktree 2  │         │  worktree 3  │
│  [main]      │         │  [feat/xyz]  │         │  [fix/abc]   │
└──────────────┘         └──────────────┘         └──────────────┘
```

### Why Not `git stash` or `git switch`?

When working on a feature branch and an urgent bug report or review request arrives, the traditional workflow requires:

1. `git stash push -m "WIP feature"`
2. `git switch main`
3. `git switch -c fix/urgent-bug`
4. ... fix bug, test, commit, push ...
5. `git switch feat/my-feature`
6. `git stash pop` (and resolve potential stash conflicts)

**Pain points this introduces in WorkSphere:**
- **Build & Cache Thrashing**: Switching branches triggers Next.js, Turbopack, and TypeScript compilation cache invalidations, forcing full re-compilations.
- **Lost Context**: Stashes can be forgotten, accidentally dropped, or cause messy conflicts when reapplied.
- **Sequential Bottleneck**: You cannot test or run your feature branch dev server side-by-side with your bugfix branch.

With `git worktree`, you leave your feature branch running in its own folder and simply open your bugfix worktree in a second editor window. No stashing, no cache invalidation, no context lost.

### Why Not Multiple `git clone` Copies?

Cloning the repository several times creates completely disconnected repositories:

| Metric | Multiple `git clone` | Single Repo with `git worktree` |
| :--- | :--- | :--- |
| **Disk Space** | Duplicates the full Git object database (several hundred MBs per clone) | Shares one `.git` database; worktrees only store checked-out files |
| **Fetch Overhead** | Must run `git fetch` in every clone separately | One `git fetch upstream` updates all worktrees immediately |
| **Branch Sharing** | Branches created in clone A are invisible in clone B until pushed to remote | All local branches, commits, and stashes are instantly accessible across all worktrees |
| **Remotes & Config** | Must re-configure `upstream`, user name, email, and hooks per clone | Configured once in the primary repository |

---

## 2. Recommended Folder Structure

To keep your workspace organized and prevent worktrees from cluttering your primary repository or being tracked by Git, maintain a dedicated parent directory.

We recommend organizing WorkSphere into dedicated sibling folders:

```text
WorkSphere-workspace/
├── WorkSphere/                     # Primary repository (tracks upstream/main)
├── WorkSphere-features/            # Directory containing feature worktrees
│   ├── feat-audio-spectrum/        # Worktree on branch feat/audio-spectrum
│   └── feat-telemetry-widget/      # Worktree on branch feat/telemetry-widget
└── WorkSphere-fixes/               # Directory containing bugfix worktrees
    ├── fix-modal-contrast/         # Worktree on branch fix/modal-contrast
    └── fix-geo-clamping/           # Worktree on branch fix/geo-clamping
```

> [!TIP]
> Keep your primary `WorkSphere/` repository on `main` and use it exclusively for fetching upstream updates, reviewing documentation, and spawning new worktrees. Perform all active code changes inside feature and fix worktrees.

---

## 3. Step-by-Step Commands

All commands below include executable examples for both **Bash** (macOS, Linux, Git Bash) and **PowerShell** (Windows).

### 3.1 Creating a Worktree for a New Branch

Before creating a new worktree, fetch the latest changes from the official `upstream` repository:

**Bash:**
```bash
# Navigate to your primary WorkSphere directory
cd /path/to/WorkSphere-workspace/WorkSphere

# Update upstream refs
git fetch upstream

# Create the worktree and branch off upstream/main
git worktree add ../WorkSphere-features/feat-telemetry-widget -b feat/telemetry-widget upstream/main
```

**PowerShell:**
```powershell
# Navigate to your primary WorkSphere directory
Set-Location -Path "$HOME\Documents\GitHub\WorkSphere-workspace\WorkSphere"

# Update upstream refs
git fetch upstream

# Create the worktree and branch off upstream/main
git worktree add ..\WorkSphere-features\feat-telemetry-widget -b feat/telemetry-widget upstream/main
```

This command does two things simultaneously:
1. Creates a new Git branch named `feat/telemetry-widget` starting from `upstream/main`.
2. Checks out that branch into a newly created sibling folder (`../WorkSphere-features/feat-telemetry-widget`).

### 3.2 Creating a Worktree for an Existing Branch

If you already have a branch created locally or pulled from a remote:

**Bash:**
```bash
git worktree add ../WorkSphere-fixes/fix-modal-contrast fix/add-high-contrast-focus-indicators
```

**PowerShell:**
```powershell
git worktree add ..\WorkSphere-fixes\fix-modal-contrast fix/add-high-contrast-focus-indicators
```

### 3.3 Listing Active Worktrees

To view all connected worktrees, their directory paths, current commit hashes, and checked-out branches:

**Bash / PowerShell:**
```bash
git worktree list
```

**Example Output:**
```text
C:/Users/User/WorkSphere-workspace/WorkSphere                         60795aa9 [main]
C:/Users/User/WorkSphere-workspace/WorkSphere-features/feat-telemetry-widget  aa2c8727 [feat/telemetry-widget]
C:/Users/User/WorkSphere-workspace/WorkSphere-fixes/fix-modal-contrast         b6bd4045 [fix/modal-contrast]
```

To output machine-parseable porcelain metadata (useful for scripts and CI):
```bash
git worktree list --porcelain
```

### 3.4 Removing a Worktree

When your pull request has been merged and you are finished with a worktree, delete it cleanly:

**Bash:**
```bash
# Ensure you are not currently inside the directory you are removing
cd ../WorkSphere

# Remove the worktree
git worktree remove ../WorkSphere-features/feat-telemetry-widget
```

**PowerShell:**
```powershell
Set-Location -Path ..\WorkSphere
git worktree remove ..\WorkSphere-features\feat-telemetry-widget
```

> [!NOTE]
> If the worktree contains untracked files or uncommitted modifications, Git will refuse to remove it to prevent accidental data loss. If you are certain you want to discard those untracked files (e.g., local build artifacts), pass the `--force` flag:
> ```bash
> git worktree remove --force ../WorkSphere-features/feat-telemetry-widget
> ```

After removing the worktree, you can safely delete the local branch if it has been merged:
```bash
git branch -d feat/telemetry-widget
```

### 3.5 Pruning Orphaned Worktree Metadata

If you accidentally delete a worktree folder using your operating system's File Explorer or `rm -rf` instead of using `git worktree remove`, Git retains administrative metadata in `.git/worktrees/`.

To clean up stale references:

**Bash / PowerShell:**
```bash
# Dry run to see what will be pruned
git worktree prune --dry-run -v

# Prune stale records
git worktree prune -v
```

### 3.6 Locking and Unlocking Worktrees

If you store a worktree on a removable storage drive, or want to prevent a long-running experimental worktree from being pruned during administrative cleanups, lock it:

**Lock a Worktree:**
```bash
git worktree lock ../WorkSphere-features/feat-telemetry-widget --reason "Active feature sprint"
```

**Unlock a Worktree:**
```bash
git worktree unlock ../WorkSphere-features/feat-telemetry-widget
```

---

## 4. Complete Contributor Lifecycle Walkthrough

Here is an end-to-end workflow demonstrating how to claim an issue, work in a worktree, commit, and submit a PR:

### Step 1: Claim the Issue
Find an open issue on GitHub and comment `/claim`. Wait for `@github-actions` to assign it to you. Note the issue number (e.g., `#7468`).

### Step 2: Fetch and Spawn a Worktree
**Bash:**
```bash
cd /path/to/WorkSphere
git fetch upstream
git worktree add ../WorkSphere-fixes/issue-7468 -b docs/worktree-guide upstream/main
```

**PowerShell:**
```powershell
Set-Location -Path ..\WorkSphere
git fetch upstream
git worktree add ..\WorkSphere-fixes\issue-7468 -b docs/worktree-guide upstream/main
```

### Step 3: Enter the Worktree & Initialize Environment
**Bash:**
```bash
cd ../WorkSphere-fixes/issue-7468

# Copy local environment variables
cp ../WorkSphere/.env.local .env.local

# Install dependencies and generate Prisma Client
npm install --legacy-peer-deps
npx prisma generate
```

**PowerShell:**
```powershell
Set-Location -Path ..\WorkSphere-fixes\issue-7468

# Copy local environment variables
Copy-Item ..\WorkSphere\.env.local .env.local

# Install dependencies and generate Prisma Client
npm install --legacy-peer-deps
npx prisma generate
```

### Step 4: Develop, Verify, and Commit
Open the worktree in your IDE (e.g. `code .`). Make your modifications and run verification checks:

```bash
# Verification checks
npx tsc --noEmit
npm test
npm run lint

# Stage and commit following Conventional Commits format
git add .
git commit -m "docs: document Git worktree workflow and branch isolation guide (closes #7468)"
```

### Step 5: Push and Open Pull Request
```bash
git push -u origin docs/worktree-guide
```
Open a Pull Request on GitHub with the title matching:
```text
docs: document Git worktree workflow and branch isolation guide (closes #7468)
```

### Step 6: Cleanup After Merge
Once your PR is merged, return to your primary repository and remove the worktree:
**Bash:**
```bash
cd /path/to/WorkSphere
git worktree remove ../WorkSphere-fixes/issue-7468
git branch -d docs/worktree-guide
```

**PowerShell:**
```powershell
Set-Location -Path ..\WorkSphere
git worktree remove ..\WorkSphere-fixes\issue-7468
git branch -d docs/worktree-guide
```

---

## 5. Common Pitfalls & WorkSphere Nuances

### Pitfall 1: Linked `node_modules` and Dependency Collisions

> [!CAUTION]
> **Never symlink `node_modules` between worktrees.**
> Although symlinking `node_modules` saves disk space, it causes catastrophic failures when switching between branches with different dependencies, package versions, or Prisma schemas.

**Why this breaks:**
1. Running `npm install` on branch A modifies the shared `node_modules`, breaking active dev servers or tests on branch B.
2. Next.js and Webpack build caches in `.next/` become corrupted when modules change beneath them.
3. Binary dependencies (such as `@swc/core` and `prisma`) depend on precise architecture bindings matching the active `package-lock.json`.

**Recommended Practice**: Allow each worktree to maintain its own independent `node_modules` folder. Run `npm install` (or `npm install --legacy-peer-deps`) separately inside each worktree.

---

### Pitfall 2: Missing Environment Files (`.env.local`)

`.env.local` and `.env` files are git-ignored to prevent leaking credentials. When you spawn a new worktree, it will **not** inherit `.env.local` automatically.

**Symptom:** Next.js throws missing variable errors (e.g., `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not defined`) or database connection errors.

**Fix:** Copy `.env.local` from your primary repository directory:

**Bash:**
```bash
cp ../WorkSphere/.env.local .env.local
```

**PowerShell:**
```powershell
Copy-Item ..\WorkSphere\.env.local .env.local
```

---

### Pitfall 3: Prisma Client Generation

WorkSphere relies heavily on Prisma ORM for type generation (`@prisma/client`). The generated client lives inside `<worktree>/node_modules/.prisma/client`.

**Symptom:** TypeScript errors such as `Cannot find module '@prisma/client'` or missing model types on `prisma.venue`.

**Fix:** Whenever you create a worktree or check out a branch modifying `prisma/schema.prisma`, generate the client:

```bash
npx prisma generate
```

---

### Pitfall 4: Dev Server Port Collisions

By default, Next.js runs on port `3000`. If you run `npm run dev` in your primary repository and attempt to start another dev server in a worktree, the second instance will either fail or attempt an automatic fallback.

**Fix:** Explicitly designate an alternate port for secondary worktree servers:

**Bash:**
```bash
PORT=3001 npm run dev
```

**PowerShell:**
```powershell
$env:PORT=3001; npm run dev
```

---

### Pitfall 5: Branch Already Checked Out Error

Git strictly prevents the same branch from being checked out simultaneously in two worktrees.

**Error Message:**
```text
fatal: 'feat/telemetry-widget' is already checked out at 'C:/Users/.../WorkSphere'
```

**Why this happens:** Git maintains safety locks to prevent split-brain history where two different working directories commit divergent changes to the same branch ref at the same time.

**Fix:**
1. Check which worktree holds the branch:
   ```bash
   git worktree list
   ```
2. Switch that worktree to a different branch (e.g. `main` or a temporary branch), or use the existing worktree folder directly instead of creating a second one.

---

### Pitfall 6: Deleting Folders Manually Without `git worktree remove`

If you delete a worktree directory using Windows File Explorer, Finder, or `rm -rf`, Git continues to track the worktree in its internal `.git/worktrees/` index.

**Symptom:** Git complains that the branch is still checked out, or `git worktree list` displays the deleted folder marked as `[prunable]`.

**Fix:** Run `git worktree prune`:
```bash
git worktree prune -v
```

---

### Pitfall 7: Git Hooks and Husky Execution on Windows

In a linked worktree, `.git` is not a directory; it is a text file containing a reference:
```text
gitdir: C:/Users/.../WorkSphere/.git/worktrees/feat-telemetry-widget
```

Husky and pre-commit hooks read this reference automatically. However, on Windows, ensure your PowerShell execution policy is configured properly so Husky hooks can execute:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

For comprehensive guidance on resolving hook execution issues, consult the [Windows Husky & Git Hooks Troubleshooting Guide](WINDOWS_HOOKS_TROUBLESHOOTING.md).

---

## 6. Quick Reference Cheat Sheet

| Task | Bash / macOS / Linux | PowerShell (Windows) |
| :--- | :--- | :--- |
| **Add New Worktree & Branch** | `git worktree add <path> -b <branch> upstream/main` | `git worktree add <path> -b <branch> upstream/main` |
| **Add Worktree (Existing Branch)** | `git worktree add <path> <branch>` | `git worktree add <path> <branch>` |
| **List All Worktrees** | `git worktree list` | `git worktree list` |
| **List Detailed (Porcelain)** | `git worktree list --porcelain` | `git worktree list --porcelain` |
| **Remove Worktree Cleanly** | `git worktree remove <path>` | `git worktree remove <path>` |
| **Force Remove Worktree** | `git worktree remove --force <path>` | `git worktree remove --force <path>` |
| **Prune Stale Worktree Records** | `git worktree prune -v` | `git worktree prune -v` |
| **Lock Worktree** | `git worktree lock <path> --reason "..."` | `git worktree lock <path> --reason "..."` |
| **Unlock Worktree** | `git worktree unlock <path>` | `git worktree unlock <path>` |
| **Run Dev Server on Custom Port** | `PORT=3001 npm run dev` | `$env:PORT=3001; npm run dev` |

---

## 🔗 Related Resources

- [WorkSphere Contributing Guide](../../CONTRIBUTING.md)
- [WOCS 2026 Level Evaluation Guide](../WOCS_LEVEL_GUIDE.md)
- [Testing Playbook](../TESTING_PLAYBOOK.md)
- [Windows Husky & Git Hooks Troubleshooting Guide](WINDOWS_HOOKS_TROUBLESHOOTING.md)
- [Official Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
