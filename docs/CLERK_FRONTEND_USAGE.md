\# Clerk Authentication — Frontend Usage Guide



This guide documents how to use Clerk's React hooks and pre-built components inside \*\*client components\*\* in WorkSphere. It covers checking auth state, protecting routes on the client, and accessing user metadata.



> \*\*Scope:\*\* This doc is for client-side ("use client") components. Server-side auth (middleware, server actions, route handlers) is out of scope here.



\---



\## Table of Contents



1\. \[Setup Recap](#setup-recap)

2\. \[Checking Auth State](#checking-auth-state)

&#x20;  - \[`useAuth()`](#useauth)

&#x20;  - \[`useUser()`](#useuser)

&#x20;  - \[`useSession()`](#usesession)

3\. \[Protecting Routes on the Client](#protecting-routes-on-the-client)

4\. \[Accessing User Metadata](#accessing-user-metadata)

5\. \[Pre-built Components](#pre-built-components)

&#x20;  - \[`<SignedIn>` / `<SignedOut>`](#signedin--signedout)

&#x20;  - \[`<SignIn>` / `<SignUp>`](#signin--signup)

&#x20;  - \[`<UserButton>`](#userbutton)

&#x20;  - \[`<ClerkLoaded>` / `<ClerkLoading>`](#clerkloaded--clerkloading)

6\. \[Common Patterns](#common-patterns)

7\. \[Troubleshooting](#troubleshooting)



\---



\## Setup Recap



All client components using Clerk hooks/components must be rendered inside a `<ClerkProvider>`, which is already configured at the root layout (`app/layout.tsx`) in WorkSphere. You don't need to add it again in individual pages.



```tsx

// app/layout.tsx (already configured)

import { ClerkProvider } from '@clerk/nextjs'



export default function RootLayout({ children }: { children: React.ReactNode }) {

&#x20; return (

&#x20;   <ClerkProvider>

&#x20;     <html lang="en">

&#x20;       <body>{children}</body>

&#x20;     </html>

&#x20;   </ClerkProvider>

&#x20; )

}

```



Any component that uses Clerk hooks must be marked as a client component:



```tsx

'use client'

```



\---



\## Checking Auth State



\### `useAuth()`



The lightweight hook for auth status, user ID, session ID, and org info. Use this when you \*\*don't need full user profile data\*\* — it's cheaper and updates faster.



```tsx

'use client'



import { useAuth } from '@clerk/nextjs'



export default function AuthStatus() {

&#x20; const { isLoaded, isSignedIn, userId, sessionId, getToken } = useAuth()



&#x20; if (!isLoaded) {

&#x20;   return <p>Loading...</p>

&#x20; }



&#x20; if (!isSignedIn) {

&#x20;   return <p>You are signed out</p>

&#x20; }



&#x20; return (

&#x20;   <div>

&#x20;     <p>Signed in as user: {userId}</p>

&#x20;     <p>Session: {sessionId}</p>

&#x20;   </div>

&#x20; )

}

```



Key fields:



| Field | Description |

|---|---|

| `isLoaded` | `true` once Clerk has finished initializing |

| `isSignedIn` | `true` if the user has an active session |

| `userId` | Current user's Clerk ID (or `null`) |

| `sessionId` | Current session ID (or `null`) |

| `orgId` / `orgRole` | Active organization context, if used |

| `getToken()` | Async function to retrieve a session JWT (useful for API calls) |



\*\*Getting a token for API requests:\*\*



```tsx

const { getToken } = useAuth()



async function callApi() {

&#x20; const token = await getToken()

&#x20; const res = await fetch('/api/tasks', {

&#x20;   headers: { Authorization: `Bearer ${token}` },

&#x20; })

&#x20; return res.json()

}

```



\### `useUser()`



Use this when you need the full \*\*user profile object\*\* (name, email, image, metadata).



```tsx

'use client'



import { useUser } from '@clerk/nextjs'



export default function ProfileCard() {

&#x20; const { isLoaded, isSignedIn, user } = useUser()



&#x20; if (!isLoaded || !isSignedIn) {

&#x20;   return null

&#x20; }



&#x20; return (

&#x20;   <div>

&#x20;     <img src={user.imageUrl} alt={user.fullName ?? 'User avatar'} />

&#x20;     <h2>{user.fullName}</h2>

&#x20;     <p>{user.primaryEmailAddress?.emailAddress}</p>

&#x20;   </div>

&#x20; )

}

```



> `useUser()` re-renders whenever the user object changes (e.g. after `user.update()`), which is useful for profile edit forms.



\### `useSession()`



Gives you access to the active `Session` object directly — useful for session-level metadata or expiry checks.



```tsx

'use client'



import { useSession } from '@clerk/nextjs'



export default function SessionInfo() {

&#x20; const { isLoaded, session } = useSession()



&#x20; if (!isLoaded || !session) return null



&#x20; return (

&#x20;   <p>

&#x20;     Session expires at: {new Date(session.expireAt).toLocaleString()}

&#x20;   </p>

&#x20; )

}

```



\---



\## Protecting Routes on the Client



For client-rendered pages/components, gate content using `isLoaded` + `isSignedIn` from `useAuth()`, and redirect if the user is not authenticated.



```tsx

'use client'



import { useAuth } from '@clerk/nextjs'

import { useRouter } from 'next/navigation'

import { useEffect } from 'react'



export default function ProtectedPage({ children }: { children: React.ReactNode }) {

&#x20; const { isLoaded, isSignedIn } = useAuth()

&#x20; const router = useRouter()



&#x20; useEffect(() => {

&#x20;   if (isLoaded \&\& !isSignedIn) {

&#x20;     router.push('/sign-in')

&#x20;   }

&#x20; }, \[isLoaded, isSignedIn, router])



&#x20; if (!isLoaded || !isSignedIn) {

&#x20;   return <p>Checking authentication...</p>

&#x20; }



&#x20; return <>{children}</>

}

```



> \*\*Note:\*\* Client-side checks are a UX convenience, not a security boundary. Sensitive routes/data must also be protected server-side (e.g. via `clerkMiddleware` and server-side `auth()` checks in route handlers/server actions). Never rely on client-only gating to protect real data.



\### Simpler alternative: `<SignedIn>` / `<SignedOut>`



For simple conditional rendering (not full-page redirects), the pre-built components below are often cleaner than manual hook checks.



\---



\## Accessing User Metadata



Clerk supports three metadata buckets on the `User` object:



| Metadata type | Read (client) | Write (client) |

|---|---|---|

| `publicMetadata` | ✅ | ❌ (read-only on client) |

| `unsafeMetadata` | ✅ | ✅ |

| `privateMetadata` | ❌ (server only) | ❌ (server only) |



```tsx

'use client'



import { useUser } from '@clerk/nextjs'



export default function RoleBadge() {

&#x20; const { user, isLoaded } = useUser()



&#x20; if (!isLoaded || !user) return null



&#x20; const role = user.publicMetadata.role as string | undefined



&#x20; return <span>Role: {role ?? 'member'}</span>

}

```



\*\*Updating `unsafeMetadata` from the client\*\* (e.g. onboarding preferences):



```tsx

'use client'



import { useUser } from '@clerk/nextjs'



export default function OnboardingStep() {

&#x20; const { user } = useUser()



&#x20; async function savePreference(theme: string) {

&#x20;   await user?.update({

&#x20;     unsafeMetadata: { ...user.unsafeMetadata, theme },

&#x20;   })

&#x20; }



&#x20; return <button onClick={() => savePreference('dark')}>Use dark theme</button>

}

```



> To set `publicMetadata` or `privateMetadata`, use the Clerk Backend SDK from a server action or API route — these are not writable from the client for security reasons.



\---



\## Pre-built Components



\### `<SignedIn>` / `<SignedOut>`



Conditionally render UI based on auth state without manually checking `isSignedIn`.



```tsx

'use client'



import { SignedIn, SignedOut } from '@clerk/nextjs'

import Link from 'next/link'



export default function NavAuthSection() {

&#x20; return (

&#x20;   <>

&#x20;     <SignedIn>

&#x20;       <Link href="/dashboard">Dashboard</Link>

&#x20;     </SignedIn>

&#x20;     <SignedOut>

&#x20;       <Link href="/sign-in">Sign In</Link>

&#x20;     </SignedOut>

&#x20;   </>

&#x20; )

}

```



\### `<SignIn>` / `<SignUp>`



Full pre-built auth forms. Typically mounted on catch-all routes:



```tsx

// app/sign-in/\[\[...sign-in]]/page.tsx

import { SignIn } from '@clerk/nextjs'



export default function Page() {

&#x20; return <SignIn />

}

```



```tsx

// app/sign-up/\[\[...sign-up]]/page.tsx

import { SignUp } from '@clerk/nextjs'



export default function Page() {

&#x20; return <SignUp />

}

```



\### `<UserButton>`



Drop-in avatar menu with sign-out, profile, and account management.



```tsx

'use client'



import { UserButton } from '@clerk/nextjs'



export default function Navbar() {

&#x20; return (

&#x20;   <nav>

&#x20;     <UserButton afterSignOutUrl="/" />

&#x20;   </nav>

&#x20; )

}

```



\### `<ClerkLoaded>` / `<ClerkLoading>`



Useful for showing a skeleton/spinner while Clerk initializes, before `isLoaded` is safe to trust.



```tsx

'use client'



import { ClerkLoaded, ClerkLoading } from '@clerk/nextjs'



export default function AuthGate({ children }: { children: React.ReactNode }) {

&#x20; return (

&#x20;   <>

&#x20;     <ClerkLoading>

&#x20;       <p>Loading auth...</p>

&#x20;     </ClerkLoading>

&#x20;     <ClerkLoaded>{children}</ClerkLoaded>

&#x20;   </>

&#x20; )

}

```



\---



\## Common Patterns



\*\*Fetching an API only after auth is confirmed:\*\*



```tsx

'use client'



import { useAuth } from '@clerk/nextjs'

import { useEffect, useState } from 'react'



export default function Tasks() {

&#x20; const { isLoaded, isSignedIn, getToken } = useAuth()

&#x20; const \[tasks, setTasks] = useState(\[])



&#x20; useEffect(() => {

&#x20;   if (!isLoaded || !isSignedIn) return



&#x20;   async function load() {

&#x20;     const token = await getToken()

&#x20;     const res = await fetch('/api/tasks', {

&#x20;       headers: { Authorization: `Bearer ${token}` },

&#x20;     })

&#x20;     setTasks(await res.json())

&#x20;   }

&#x20;   load()

&#x20; }, \[isLoaded, isSignedIn, getToken])



&#x20; return <pre>{JSON.stringify(tasks, null, 2)}</pre>

}

```



\*\*Showing a role-gated UI element:\*\*



```tsx

'use client'



import { useUser } from '@clerk/nextjs'



export default function AdminPanelLink() {

&#x20; const { user, isLoaded } = useUser()

&#x20; if (!isLoaded) return null



&#x20; const isAdmin = user?.publicMetadata.role === 'admin'

&#x20; if (!isAdmin) return null



&#x20; return <a href="/admin">Admin Panel</a>

}

```



\---



\## Troubleshooting



| Issue | Likely Cause |

|---|---|

| `useUser`/`useAuth` returns `undefined` values | Component isn't wrapped in `<ClerkProvider>`, or you rendered before `isLoaded` is `true` |

| Hydration mismatch errors | You rendered auth-dependent UI without waiting for `isLoaded`, causing server/client mismatch |

| `publicMetadata` not updating after `user.update()` | `publicMetadata` can't be set from the client — update it via a server-side call, then call `user.reload()` on the client |

| Hook throws "must be used within ClerkProvider" | The component using the hook is rendered outside the provider tree, or is missing `'use client'` |



\---



\## References



\- \[Clerk Next.js Quickstart](https://clerk.com/docs/quickstarts/nextjs)

\- \[Clerk React Hooks Reference](https://clerk.com/docs/references/react/use-auth)

\- \[Clerk Metadata Docs](https://clerk.com/docs/users/metadata)

