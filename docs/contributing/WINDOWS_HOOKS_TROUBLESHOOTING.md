# Windows Husky & Git Hooks Troubleshooting Guide

This guide assists Windows contributors encountering errors with Husky pre-commit hooks, PowerShell execution policies, or line-ending conversions in WorkSphere.

---

## 1. Overview & Common Windows Symptoms

When committing changes via `git commit`, WorkSphere triggers `.husky/pre-commit`, running `lint-staged` (which formats code with Prettier and checks staged files). On Windows environments, contributors often hit two primary hurdles:

1. **PowerShell Script Execution Policy (`PSSecurityException`)**:
   ```text
   File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system.
   + CategoryInfo : SecurityError: (:) [], PSSecurityException
   ```
2. **Line Ending Incompatibility (`\r\n` vs `\n`)**:
   ```text
   .husky/pre-commit: line 2: npx: command not found
   # OR
   /bin/sh^M: bad interpreter: No such file or directory
   ```

Following the steps below resolves these errors permanently.

---

## 2. Configuring PowerShell Script Execution Policy

By default, Windows sets the PowerShell execution policy to `Restricted`, which prohibits executing unsigned scripts such as `npm.ps1`, `npx.ps1`, or hook runners.

### Recommended Permanent Fix

Open **PowerShell** (no Administrator privileges required when scoping to `CurrentUser`) and run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

- `RemoteSigned`: Permits local scripts created on your computer to run without digital signatures, while requiring scripts downloaded from the internet to be signed by a trusted publisher.
- `-Scope CurrentUser`: Applies the policy specifically to your Windows user profile without modifying system-wide security policies or requiring elevated Administrator rights.

### Verify Policy Setting

Confirm that your user scope is properly configured:

```powershell
Get-ExecutionPolicy -List
```

Expected output:

```text
        Scope ExecutionPolicy
        ----- ---------------
MachinePolicy       Undefined
   UserPolicy       Undefined
      Process       Undefined
  CurrentUser    RemoteSigned
 LocalMachine       Undefined
```

### Temporary Session Bypass

If your corporate environment restricts changing the user scope, you can bypass the policy for your current terminal session:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

## 3. Configuring Git Line Endings (`CRLF` vs `LF`)

Windows uses Carriage Return + Line Feed (`CRLF`, `\r\n`), whereas Linux, macOS, and Git hook interpreters (such as `sh` or `bash`) expect Line Feed (`LF`, `\n`).

If Git or your editor converts scripts inside `.husky/` or `.husky/_/` to CRLF, the shell interpreter interprets `\r` as part of the command syntax (e.g. `npx\r` instead of `npx`), causing execution failures.

### Recommended Global Git Configuration

Configure Git to automatically convert CRLF to LF upon commit while keeping checkout line endings compatible with Windows:

```bash
git config --global core.autocrlf true
```

### Enforcing LF on Shell Scripts via `.gitattributes`

WorkSphere enforces LF endings on all repository shell scripts and hooks via `.gitattributes`:

```gitattributes
# Ensure Husky hooks always checkout and commit with LF
.husky/* text eol=lf
.husky/_/* text eol=lf
*.sh text eol=lf
```

### Normalizing Line Endings in Your Working Tree

If your local clone has already converted files to CRLF, renormalize your Git repository index:

```bash
# Renormalize line endings across all indexed files
git add --renormalize .
```

---

## 4. Frequently Asked Questions (FAQ)

### Q: Why do I see `.husky/pre-commit: command not found`?

**Root Cause:**
This error occurs when `.husky/pre-commit` or `.husky/_/h` contains Windows `CRLF` (`\r\n`) line endings instead of Unix `LF` (`\n`). When Git attempts to invoke the hook via the POSIX subshell `/bin/sh`, the hidden `\r` character gets concatenated to the command name, resulting in `/bin/sh\r: bad interpreter` or `npx\r: command not found`.

**Step-by-Step Resolution:**

1. **Convert `.husky/pre-commit` to LF:**
   - **Using PowerShell:**
     ```powershell
     (Get-Content .husky/pre-commit -Raw) -replace "`r`n", "`n" | Set-Content -NoNewline .husky/pre-commit
     ```
   - **Using VS Code:**
     Open `.husky/pre-commit`, locate `CRLF` in the bottom-right status bar, click it, select **LF**, and save the file.
   - **Using Git Bash / dos2unix:**
     ```bash
     dos2unix .husky/pre-commit
     dos2unix .husky/_/*
     ```

2. **Ensure Executable Permissions in Git:**
   Ensure the script is marked as an executable file within the Git index:

   ```bash
   git update-index --chmod=+x .husky/pre-commit
   ```

3. **Re-initialize Husky Hooks:**
   ```bash
   npm run prepare
   ```

---

### Q: Why do I receive `cannot spawn .husky/pre-commit: No such file or directory`?

**Root Cause:**
Git cannot locate a compatible shell executable (`sh.exe`) to execute the hook script. This typically occurs when Git was installed without adding Unix tools to PATH or when running in an isolated shell.

**Resolution:**

- Verify Git is installed and included in your system PATH (`C:\Program Files\Git\cmd` and `C:\Program Files\Git\bin`).
- Run your Git commits through **Git Bash** or a terminal where `sh` is accessible.
- Re-run `npx husky` to verify hooks path:
  ```bash
  git config core.hooksPath .husky
  ```

---

### Q: Can I bypass the pre-commit hook in an emergency?

You can bypass Git hooks using the `--no-verify` flag:

```bash
git commit -m "your message" --no-verify
```

> [!WARNING]
> Use `--no-verify` with extreme caution. Bypassing pre-commit hooks skips Prettier formatting and lint checks. Any formatting discrepancies or lint failures will be caught and rejected by the automated CI pipeline (`npm run lint` and `npm run build`).

---

## 5. Summary Checklist for Windows Contributors

Before submitting commits on Windows:

- [ ] PowerShell execution policy is configured: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- [ ] Git line endings configured globally: `git config --global core.autocrlf true`
- [ ] Files in `.husky/` have Unix `LF` line endings
- [ ] Pre-commit hook runs cleanly: `npm run prepare` followed by test commit
