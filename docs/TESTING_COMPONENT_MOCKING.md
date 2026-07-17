# Frontend Unit Test Component Mocking Boilerplate

This document outlines the standard boilerplate and mock setups for testing frontend components in the WorkSphere project. By using these standardized mocks, we ensure consistent and isolated unit tests across the application.

---

## 1. Next.js Navigation Mocks

When testing components that rely on the Next.js App Router, you must mock `useRouter` and `useParams` from `next/navigation` to prevent context errors during testing.

### Mocking `useRouter` and `useParams`

Add this setup block to the top of your test file (below your imports) or inside your global `setupTests.js` file:

```javascript
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  useParams: () => ({
    id: "mock-id-123",
  }),
  usePathname: () => "/mock-route",
}));
```

---

## 2. Clerk Authentication Mocks

WorkSphere uses Clerk for user authentication. When testing authenticated components, you must mock the Clerk hooks and components to simulate a logged-in (or logged-out) user state.

### Mocking Clerk Hooks and Components

Use this boilerplate to simulate an authenticated session. You can toggle the `mockIsSignedIn` variable to test authenticated versus public routes, and the `SignedIn` and `SignedOut` components will render accordingly.

```javascript
const mockIsSignedIn = true; // Toggle to false to test public routes

jest.mock("@clerk/nextjs", () => ({
  ...jest.requireActual("@clerk/nextjs"),
  useUser: () => ({
    isLoaded: true,
    isSignedIn: mockIsSignedIn,
    user: mockIsSignedIn
      ? {
          id: "user_mock_123",
          fullName: "Test User",
          primaryEmailAddress: { emailAddress: "test@worksphere.com" },
        }
      : null,
  }),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: mockIsSignedIn,
    userId: mockIsSignedIn ? "user_mock_123" : null,
    sessionId: mockIsSignedIn ? "session_mock_123" : null,
  }),
  // Mock standard Clerk wrapper components to respect auth state
  ClerkProvider: ({ children }) => <div>{children}</div>,
  SignedIn: ({ children }) => (mockIsSignedIn ? <div>{children}</div> : null),
  SignedOut: ({ children }) => (!mockIsSignedIn ? <div>{children}</div> : null),
}));
```

---

## 3. Standard Component Mocking Wrapper

For complex components requiring Context providers (such as Auth, Theme, or State providers), wrap your component in a custom render function. This prevents you from having to manually wrap components in every single test block.

### Boilerplate Wrapper Setup (`test-utils.js`)

Create or update your utility testing file with the following pattern. Note the `publishableKey` is provided to prevent render errors if the real `ClerkProvider` is imported instead of the mock:

```javascript
import React from "react";
import { render } from "@testing-library/react";
import { ClerkProvider } from "@clerk/nextjs";
// Import other global providers here (e.g., ThemeProvider)

const AllTheProviders = ({ children }) => {
  return (
    <ClerkProvider publishableKey="test_publishable_key">
      {/* Add other global providers here */}
      {children}
    </ClerkProvider>
  );
};

const customRender = (ui, options) =>
  render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything from testing-library
export * from "@testing-library/react";

// Override the default render method
export { customRender as render };
```

### Usage in Tests

When writing your tests, simply import `render` from your `test-utils` file instead of directly from `@testing-library/react`:

```javascript
import { render, screen } from "./test-utils";
import MyComponent from "./MyComponent";

describe("MyComponent", () => {
  it("renders correctly within all providers", () => {
    render(<MyComponent />);
    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });
});
```
