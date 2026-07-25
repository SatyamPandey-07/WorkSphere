\# State Management

This document describes how WorkSphere manages client-side state, and gives guidelines for adding new state going forward.

\## Summary

WorkSphere uses \*\*React's built-in state tools only\*\* — local component state (`useState`/`useReducer`) and the \*\*Context API\*\* for state that needs to be shared across a subtree. There is no external state management library (e.g. Zustand, Redux, Jotai) in this project. Any new state should default to one of the patterns below rather than introducing a new dependency.

\## Current Patterns

\### 1. Local state (default choice)

Most state in the app lives inside the component that uses it, via `useState`. Examples: `messages`, `filters`, `showFilters`, `showHistory` in `EnhancedChatbot.tsx`. This is the default and should stay the default — if state is only read/written by one component (and maybe passed a level or two down via props), it does not need Context.

\### 2. React Context (shared/cross-cutting state)

Context is used when state needs to be accessible from many places in the tree without prop-drilling. Current providers:

| Context | File | Scope | Wrapped where |

|---|---|---|---|

| `ThemeContext` | `src/components/ThemeProvider.tsx` | App-wide (theme + accent color) | `src/app/layout.tsx` (root) |

| `SoundContext` | `src/components/SoundProvider.tsx` | App-wide (sound effects on/off) | `src/app/layout.tsx` (root) |

| `CurrencyContext` | `src/context/CurrencyContext.tsx` | App-wide (selected display currency) | Used across venue/booking components |

| `ToastContext` | `src/components/ui/Toast.tsx` | App-wide (toast notifications) | Wraps consumers that call `toast()` |

| `ARSceneContext` | `src/components/ar/ARScene.tsx` | Local to the AR feature (Three.js scene reference) | Only within AR components |

Each of these follows the same shape:

\- A `createContext<T | undefined>(undefined)` (or a typed default)

\- A `<XProvider>` component that holds the state (usually via `useState`) and exposes it through `value={{...}}`

\- A `useX()` hook that calls `useContext` and throws/returns a safe default if used outside the provider

\### 3. Server state (not client state)

Data fetched from the API (venues, bookings, analytics, etc.) is generally fetched directly in the component that needs it (via `fetch` in `useEffect` or route handlers) and kept in local `useState`. There is currently no dedicated data-fetching/caching layer (e.g. React Query/SWR) — this is worth revisiting if server-state complexity grows, but is out of scope for this document.

\## Anti-Patterns to Avoid

\- \*\*Don't reach for Context by default.\*\* If only one component (or a couple of directly nested components) need a piece of state, keep it local and pass it via props. Context adds indirection and makes state harder to trace.

\- \*\*Don't put fast-changing values in Context\*\* (e.g. text input value on every keystroke, animation frame state). Context updates re-render every consumer; frequently-changing values belong in local state or a ref.

\- \*\*Don't create a new Context per feature without checking if an existing one already covers it.\*\* Before adding a new provider, check the table above — some concerns (e.g. anything visual/theme-related) may already belong in an existing context.

\- \*\*Don't skip the `useX()` hook wrapper.\*\* Always expose a Context via a custom hook (like `useCurrency()`, `useSound()`) rather than having components call `useContext(XContext)` directly — this keeps the "used outside provider" safety check and the API in one place.

\- \*\*Don't introduce a new state library (Zustand, Redux, Jotai, etc.) for a single feature.\*\* If Context + local state genuinely becomes insufficient project-wide (not just for one feature), that's a discussion for the whole team, not a per-PR decision.

\## Guidelines for Adding New Global State

Ask, in order:

1\. \*\*Does this state need to be shared outside the component that owns it?\*\*

&#x20; If no — use local `useState`/`useReducer`. Stop here.

2\. \*\*Is it shared, but only within a small, localized part of the tree (e.g. one feature/page)?\*\*

&#x20; Lift the state up to the closest common parent and pass it down via props. Avoid Context if 1–2 levels of prop passing is enough.

3\. \*\*Is it shared across many unrelated parts of the app (app-wide), and changes to it are relatively infrequent (e.g. theme, currency, auth-adjacent settings)?\*\*

&#x20; Create a new Context following the existing pattern:

&#x20; - `createContext<YourType | undefined>(undefined)`

&#x20; - A `YourProvider` component wrapping children, holding state internally

&#x20; - A `useYourThing()` hook that reads the context and throws a clear error if used outside the provider

&#x20; - Register the new provider in `src/app/layout.tsx` only if it truly needs to be app-wide; otherwise wrap it closer to where it's needed.

4\. \*\*Is the state actually server data (comes from an API and needs caching/revalidation)?\*\*

&#x20; Keep it as local `useState` populated by a `fetch`/route handler call for now, consistent with the rest of the codebase. Introducing a data-fetching library is a separate, larger discussion.
