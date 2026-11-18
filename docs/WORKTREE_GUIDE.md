$content = @"

# WorkSphere Git Worktree Guide

When working on multiple WorkSphere features, hotfixes, or PR reviews concurrently, switching branches in a single working directory can disrupt running Next.js development servers, background workers, and local environment states. Using `git worktree` allows you to checkout multiple branches simultaneously in separate directories without cloning duplicate repositories.

---

## 1. Creating a Worktree

To create a new isolated working directory for a feature branch without re-downloading git objects:

### PowerShell (Windows)

```powershell
# Create a worktree for a new branch
git worktree add ../worksphere-feature-name -b feature/feature-name

# Create a worktree for an existing branch
git worktree add ../worksphere-hotfix hotfix/bug-fix
```
