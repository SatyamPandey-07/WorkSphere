# Clerk Authentication — Frontend Usage Guide (v7 Standard)

This guide documents how to use Clerk's React hooks and UI components inside **client components** in WorkSphere. It covers checking auth state, protecting routes on the client, and accessing user metadata using the v7 API standard.

> **Scope:** This doc is for client-side ("use client") components. Server-side auth (middleware, server actions, route handlers) is handled in server-side context.

---

## Checking Auth State

### `useAuth()`
For authentication state metadata (checking if signed in, getting session/user IDs, generating JWT tokens):

```tsx
'use client'

import { useAuth } from '@clerk/nextjs'

export default function MyComponent() {
  const { isLoaded, userId, sessionId, getToken } = useAuth()

  if (!isLoaded) {
    return <div>Loading...</div>
  }

  if (!userId) {
    return <div>Not signed in</div>
  }

  return <div>Active User ID: {userId}</div>
}
```

### `useUser()`
Use this when you need the full **user profile object** (name, email, image, metadata):

```tsx
'use client'

import { useUser } from '@clerk/nextjs'

export default function ProfileCard() {
  const { isLoaded, isSignedIn, user } = useUser()

  if (!isLoaded || !isSignedIn) {
    return null
  }

  return (
    <div>
      <img src={user.imageUrl} alt={user.fullName ?? 'User avatar'} />
      <h2>{user.fullName}</h2>
      <p>{user.primaryEmailAddress?.emailAddress}</p>
    </div>
  )
}
```

---

## Conditional Rendering with `<Show>`

In Clerk v7, the legacy `<SignedIn>` and `<SignedOut>` components are consolidated into the single `<Show />` component.

### Signed In Views
To render elements only when the user **is authenticated**:

```tsx
import { Show, UserButton } from "@clerk/nextjs";

export default function Header() {
  return (
    <Show when="signed-in">
      <UserButton />
    </Show>
  )
}
```

### Signed Out Views
To render elements only when the user **is not authenticated**:

```tsx
import { Show } from "@clerk/nextjs";
import Link from "next/link";

export default function Header() {
  return (
    <Show when="signed-out">
      <Link href="/sign-in">Sign In</Link>
    </Show>
  )
}
```

---

## Redirects Configuration
All sign-out redirects are handled centrally in the root `src/app/layout.tsx` file inside `<ClerkProvider>`:

```tsx
<ClerkProvider afterSignOutUrl="/">
  {innerContent}
</ClerkProvider>
```

Individual `<UserButton />` instances do **not** need the `afterSignOutUrl` prop.
