@'

# Testing Guidelines & Troubleshooting

## Worker & Timer Teardown

To prevent active worker threads, open handles, or uncleared intervals from leaking across test suites and triggering Jest/Vitest open handle warnings, apply these cleanup patterns.

### 1. Timer Cleanup & Clearing

Always clear fake timers and active intervals in your test lifecycle hooks to ensure handles do not persist between test cases.

```javascript
afterEach(() => {
  vi.clearAllTimers(); // or jest.clearAllTimers()
  vi.useRealTimers();
});
const intervalHandle = setInterval(() => {
  // Polling logic
}, 1000);

if (intervalHandle && typeof intervalHandle.unref === "function") {
  intervalHandle.unref();
}
let worker;

beforeEach(() => {
  worker = new Worker(new URL("./audioProcessor.worker.js", import.meta.url));
});

afterEach(() => {
  if (worker) {
    worker.terminate();
    worker = null;
  }
});
afterEach(() => {
  if (global.audioContext && global.audioContext.state !== "closed") {
    global.audioContext.close();
  }
});
```
