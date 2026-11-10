# ❄️ Winter of Code Social (WOCS 2026) — Contribution Level Rubric

This guide explains how **Issues** and **Pull Requests** in WorkSphere are evaluated and classified into difficulty levels for **Winter of Code Social (WOCS 2026)**.

---

## 🏆 Points Breakdown

| Difficulty Level | Leaderboard Points | Target Scope                                                                                                                            |
| :--------------- | :----------------: | :-------------------------------------------------------------------------------------------------------------------------------------- |
| **`level 1`**    |    **2 points**    | Beginner-friendly fixes, documentation, minor UI/CSS styling, typos, basic null-checks.                                                 |
| **`level 2`**    |    **5 points**    | Moderate complexity, React UI components, custom hooks, API endpoints, unit/integration tests.                                          |
| **`level 3`**    |   **11 points**    | High complexity, WASM & Audio DSP, multi-agent framework, WebSockets / PartyKit, Solana Pay / Smart Escrow, database schema migrations. |

---

## 📊 Evaluation Matrix

### 🟢 Level 1 (2 Points) — Beginner-Friendly / Low Complexity

- **Target Lines of Code**: `< 50 lines` changed.
- **Relevant Areas**:
  - Documentation files: `README.md`, `CONTRIBUTING.md`, `docs/**/*.md`
  - Minor styling / CSS / Tailwind tweaks (colors, padding, spacing, typography)
  - Accessibility improvements (`aria-label`, image `alt` tags, tab indices)
  - Copy corrections, grammar, typos, and comment updates
  - Small bug fixes with localized guard clauses (e.g., null checks, input length limits)

---

### 🟡 Level 2 (5 Points) — Moderate Complexity

- **Target Lines of Code**: `50 – 300 lines` changed.
- **Relevant Areas**:
  - React UI components: New modals, forms, dropdowns, filters, responsive layouts in `src/components/**`
  - Custom React hooks: State managers, debounce/throttle helpers in `src/hooks/**`
  - Backend API route handlers: Zod validation, request handlers in `src/app/api/**`
  - Test suites: Writing unit or integration tests in Jest / React Testing Library (`__tests__/**` or `*.test.ts`)
  - Middleware & authentication checks (`src/middleware.ts`)

---

### 🔴 Level 3 (11 Points) — High Complexity / Architectural

- **Target Lines of Code**: Substantial architectural changes or `> 300 lines` of core code.
- **Relevant Areas**:
  - **WebAssembly & Audio DSP**: C code compilation, AudioWorklet, real-time decibel engine in `src/wasm/**`
  - **Multi-Agent & AI Systems**: Vector embeddings (`pgvector`), memory decay, prompt routing in `src/core/ai/**` and `src/lib/agents/**`
  - **Real-Time Collaboration**: PartyKit WebSocket rooms, WebRTC mesh networking in `party/**` and `src/lib/realtime/**`
  - **Web3 & Solana Pay**: Solana transactions, smart escrow locks, proof-of-work validators in `src/core/ledger/**` and `src/lib/solana/**`
  - **Database Architecture**: Prisma schema changes, database migrations in `prisma/**`

---

## 🤖 Automated CI/CD Classification & Sync

WorkSphere automates level assignment through GitHub Actions:

1. **Issue Creation (`auto-label-new-issue.yml`)**:
   - Analyzes title and description keywords.
   - Automatically attaches `wocs` and the appropriate `level 1`, `level 2`, or `level 3` label.
2. **PR Auto-Merge (`auto-merge.yml`)**:
   - Inspects the linked issue (`closes #<id>`) and inherits its level label.
   - If unlinked or unspecified, dynamically evaluates modified file paths, total diff lines, and complexity.
   - Applies `wocs` and `level X` **before** executing the squash merge.
3. **Webhook Dispatch**:
   - WOCS webhook receives the merged PR event with valid labels and immediately credits points to the contributor's leaderboard profile.
