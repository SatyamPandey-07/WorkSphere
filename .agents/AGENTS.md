# Project-Scoped Rules for WorkSphere

- **Pull Request Title Formatting:** When proposing or creating a pull request, always format the PR title exactly as `<type>: <short description> (closes #<issue_number>)` (e.g., `fix: handle geolocation access permission denied error gracefully (closes #100)`), where the issue number matches the issue being resolved.

- **Commit Message Formatting:** Use a concise conventional commit format:
  `<type>: <short description>`
  Examples: `fix: prevent duplicate seat check-ins`, `feat: add audit log pagination`, `refactor: simplify authentication flow`.

- **Bug Fix Scope:** When fixing an issue, make the smallest necessary change. Do not modify unrelated files, features, or formatting unless required by the fix.

- **Bug Explanation:** For every bug fix, clearly identify:
  1. Bug name
  2. Description
  3. Steps to reproduce
  4. Expected behavior
  5. Actual behavior
  6. Root cause
  7. Fix applied

- **Code Changes:** Preserve the existing coding style, naming conventions, architecture, and patterns used in WorkSphere.

- **Validation:** Before proposing a fix, verify that the reported behavior is actually caused by the changed code. Do not label theoretical or speculative issues as confirmed bugs.

- **Testing:** After making a bug fix, run the relevant tests, type checks, linting, or build checks when available.

- **PR Description:** PR descriptions should briefly explain the problem, root cause, solution, and testing performed.

- **No Unrelated Changes:** Do not include unrelated refactoring, dependency upgrades, formatting changes, or feature changes in a bug-fix PR.

- **Security:** For authentication, authorization, user data, or API-related changes, preserve existing security checks and do not bypass validation merely to make a feature work.

- **Issue Reference:** The issue number in the PR title must correspond to the actual issue being fixed. Do not invent or reuse an unrelated issue number.

- **Final Verification:** Before submitting a PR, verify that the implementation, tests, commit message, PR title, and issue reference are consistent with each other.
