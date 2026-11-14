$content = @"
# WorkSphere Testing Playbook

This playbook provides standard testing patterns, mocking strategies, and guidelines for writing fast, isolated Jest unit and React Testing Library (RTL) integration tests across the WorkSphere codebase.

---

## 1. Core Testing Philosophy
- **Isolation**: Each test suite must run independently without leaking state to other tests.
- **Speed**: Use light unit mocks for external browser APIs and third-party UI libraries.
- **Teardown**: Always clean up global mocks and timers in `afterEach()` or `beforeEach()` to avoid Jest worker memory leaks.

---

## 2. Standard Mocking Patterns

### 2.1 Clerk Authentication (`@clerk/nextjs`)
Mock `useUser` and `useAuth` to simulate signed-in and signed-out states.

```typescript
import { useUser, useAuth } from "@clerk/nextjs";

jest.mock("@clerk/nextjs", () => ({
  useUser: jest.fn(),
  useAuth: jest.fn(),
}));

(useUser as jest.Mock).mockReturnValue({
  isSignedIn: true,
  user: { id: "user_123", firstName: "Soham", primaryEmailAddress: { emailAddress: "soham@example.com" } },
});