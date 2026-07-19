# Testing with Mock Service Worker (MSW)

## Overview

WorkSphere uses **Mock Service Worker (MSW)** to mock network requests during automated testing. Rather than making real HTTP requests, MSW intercepts API calls and returns predefined responses, allowing tests to execute consistently without depending on external services, network connectivity, or backend availability.

MSW is configured only for the test environment and helps ensure component, API, and integration tests remain deterministic and reproducible.

---

## 1. Why Mock Service Worker?

### What is MSW?

Mock Service Worker intercepts HTTP requests at the network layer, allowing the application to behave as though it is communicating with a real backend while returning mocked responses defined inside the test suite.

Unlike manually mocking `fetch()` or API utilities, MSW preserves the application's actual networking logic, making tests closer to real-world behavior.

### Benefits

Using MSW provides several advantages:

- Tests run without requiring a backend server.
- API responses remain consistent across environments.
- Success and failure scenarios are easy to simulate.
- Network edge cases can be tested without modifying production code.
- Components interact with mocked endpoints exactly as they would with real APIs.

---

## 2. Project Structure

The MSW configuration is organized into three primary files.

```text
src/
├── test/
│   ├── handlers.ts
│   ├── server.ts
│   └── setup.ts
```

### handlers.ts

Contains all mocked API endpoints used throughout the test suite.

Example responsibilities include:

- Returning mock venue data
- Mocking authentication responses
- Simulating analytics endpoints
- Returning validation errors
- Mocking server failures

### server.ts

Creates the MSW server using all registered request handlers.

```ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
```

### setup.ts

Starts and stops the mock server before and after tests.

Typical lifecycle:

- Start server before all tests
- Reset handlers after each test
- Close server after all tests complete

---

## 3. Running Tests

Execute the complete test suite:

```bash
npm test
```

or

```bash
pnpm test
```

Run tests in watch mode:

```bash
npm test -- --watch
```

MSW starts automatically during the testing lifecycle and requires no manual initialization.

---

## 4. Creating Mock Handlers

Handlers define how mocked endpoints should respond.

Example:

```ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/venues", () => {
    return HttpResponse.json([
      {
        id: "1",
        name: "Mock Cafe",
        wifi: true,
      },
    ]);
  }),
];
```

Handlers may return:

- JSON payloads
- Empty responses
- Error responses
- Delayed responses
- Custom status codes

---

## 5. Overriding Responses

Individual tests may override the default handlers to simulate different scenarios without affecting the rest of the test suite.

Example:

```ts
import { server } from "../test/server";
import { http, HttpResponse } from "msw";

server.use(
  http.get("/api/venues", () => {
    return HttpResponse.json(
      {
        error: "Internal Server Error",
      },
      {
        status: 500,
      },
    );
  }),
);
```

Overrides remain active only for the current test because handlers are automatically reset afterward.

---

## 6. Testing Error Scenarios

MSW allows tests to verify application behavior under various failure conditions.

Common scenarios include:

- HTTP 400 validation errors
- HTTP 401 authentication failures
- HTTP 403 authorization failures
- HTTP 404 missing resources
- HTTP 500 server errors
- Slow or delayed network responses
- Empty API responses

Example:

```ts
server.use(
  http.post("/api/auth/login", () => {
    return HttpResponse.json(
      {
        error: "Invalid credentials",
      },
      {
        status: 401,
      },
    );
  }),
);
```

This makes it possible to verify loading states, retry logic, and error messages without modifying application code.

---

## 7. Best Practices

To keep the test suite maintainable:

- Keep common handlers inside `handlers.ts`.
- Override handlers only within tests that require different behavior.
- Reset handlers after each test to prevent cross-test contamination.
- Mock external services instead of internal implementation details.
- Reuse handlers whenever multiple tests depend on identical responses.

---

## 8. Troubleshooting

### Requests Are Not Being Mocked

If requests reach the real network instead of MSW:

- Verify the request URL exactly matches the handler.
- Ensure the HTTP method (`GET`, `POST`, etc.) is correct.
- Confirm the MSW server has been started before tests execute.
- Check that the handler has been imported and registered.

### Incorrect Handler Is Executed

If the wrong response is returned:

- Check whether another handler overrides the same endpoint.
- Verify handler registration order.
- Ensure previous tests are resetting handlers correctly.

### Test Passes Individually but Fails in the Full Suite

This usually indicates shared state between tests.

Ensure:

- `server.resetHandlers()` executes after every test.
- Global variables are cleared between test runs.
- Each test creates its own independent mock data.

---

## References

- Mock Service Worker Documentation: https://mswjs.io/
- Vitest Documentation: https://vitest.dev/
- Jest Documentation: https://jestjs.io/
