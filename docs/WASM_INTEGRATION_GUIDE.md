# WebAssembly (WASM) Integration with Next.js App Router

## Overview

This document explains how WebAssembly (WASM) modules are:

- Compiled
- Loaded inside Web Workers
- Integrated with the Next.js App Router
- Used to perform CPU-intensive operations without blocking the UI

---

# Why WebAssembly?

JavaScript is excellent for most frontend tasks, but computationally expensive workloads such as:

- Image processing
- Video encoding
- Compression
- Cryptography
- AI inference
- Scientific calculations

can block the browser's main thread.

WebAssembly provides near-native performance while remaining portable across browsers.

Using **Web Workers + WASM** allows these heavy computations to run in a separate thread.

---

# Architecture

```text
                User
                  │
                  ▼
         Next.js App Router
                  │
                  ▼
          React Client Component
                  │
          postMessage()
                  │
                  ▼
          Web Worker Thread
                  │
        Load & Instantiate WASM
                  │
                  ▼
      Execute Native Computation
                  │
          postMessage(result)
                  │
                  ▼
          React UI Updates
```

---

# Project Structure

```text
app/
├── page.tsx
├── components/
│   └── WasmDemo.tsx
│
public/
│   └── wasm/
│       └── calculator.wasm
│
workers/
│   └── wasm.worker.ts
│
lib/
└── wasm.ts
```

---

# Compiling WASM Modules

WebAssembly modules are usually generated from languages such as:

- Rust
- C
- C++
- Zig
- AssemblyScript

## Example (Rust)

Install the tooling:

```bash
cargo install wasm-pack
```

Create the package:

```bash
wasm-pack build --target web
```

Generated output:

```text
pkg/
├── calculator_bg.wasm
├── calculator.js
├── package.json
```

The `.wasm` binary contains the compiled native code.

---

# Placing the WASM File

For Next.js, the simplest approach is placing the compiled module inside the **public** directory.

Example:

```text
public/
└── wasm/
    └── calculator.wasm
```

It becomes available at:

```
/wasm/calculator.wasm
```

---

# Loading the WASM Module

Inside the worker:

```ts
const response = await fetch("/wasm/calculator.wasm");

const bytes = await response.arrayBuffer();

const wasm = await WebAssembly.instantiate(bytes);

const exports = wasm.instance.exports;
```

The exported functions become available through:

```ts
exports.add(...)
exports.multiply(...)
```

---

# Using WebAssembly.instantiateStreaming()

When supported by the server:

```ts
const wasm = await WebAssembly.instantiateStreaming(
  fetch("/wasm/calculator.wasm"),
);
```

Advantages:

- Lower memory usage
- Faster startup
- Streaming compilation

Fallback:

```ts
const response = await fetch("/wasm/calculator.wasm");

const bytes = await response.arrayBuffer();

await WebAssembly.instantiate(bytes);
```

---

# Loading WASM in a Web Worker

Example worker:

```ts
let wasmExports: any;

async function initialize() {
  const response = await fetch("/wasm/calculator.wasm");

  const bytes = await response.arrayBuffer();

  const wasm = await WebAssembly.instantiate(bytes);

  wasmExports = wasm.instance.exports;
}

initialize();

self.onmessage = (event) => {
  const result = wasmExports.add(event.data.a, event.data.b);

  self.postMessage(result);
};
```

The worker performs all heavy computation without blocking the browser UI.

---

# Creating the Worker in Next.js

Example:

```ts
const worker = new Worker(
  new URL("../workers/wasm.worker.ts", import.meta.url),
  {
    type: "module",
  },
);
```

Sending work:

```ts
worker.postMessage({
  a: 5,
  b: 8,
});
```

Receiving results:

```ts
worker.onmessage = (event) => {
  console.log(event.data);
};
```

---

# Integrating with the App Router

Because Web Workers depend on browser APIs, they must be created inside **Client Components**.

Example:

```tsx
"use client";

import { useEffect } from "react";

export default function WasmDemo() {
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/wasm.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );

    worker.postMessage({
      a: 4,
      b: 9,
    });

    worker.onmessage = (event) => {
      console.log(event.data);
    };

    return () => worker.terminate();
  }, []);

  return <div>Running WebAssembly...</div>;
}
```

This component can then be rendered from:

```tsx
app / page.tsx;
```

---

# Client vs Server Components

| Feature         | Client Component | Server Component |
| --------------- | ---------------- | ---------------- |
| Web Worker      | ✅               | ❌               |
| Browser APIs    | ✅               | ❌               |
| DOM Access      | ✅               | ❌               |
| WASM via Worker | ✅               | ❌               |
| Data Fetching   | ✅               | ✅               |

Web Workers only exist in the browser, making Client Components the appropriate place to initialize them.

---

# Communication Flow

```text
React Component

        │
        ▼
postMessage()

        │

        ▼
Web Worker

        │

        ▼
WASM Function

        │

        ▼
Result

        │

        ▼
postMessage()

        │

        ▼
React State Update
```

---

# Error Handling

Wrap initialization in a `try/catch` block:

```ts
try {
  const wasm = await WebAssembly.instantiateStreaming(
    fetch("/wasm/calculator.wasm"),
  );
} catch (error) {
  console.error("Failed to load WASM:", error);
}
```

Always validate incoming worker messages before invoking exported functions.

---

# Performance Considerations

- Cache the instantiated WASM module to avoid repeated initialization.
- Reuse a single Web Worker when possible instead of creating one per task.
- Prefer `WebAssembly.instantiateStreaming()` when supported.
- Transfer large binary data using Transferable Objects to minimize copying.
- Batch multiple operations into a single worker request when practical.

---

# Security Considerations

- Serve WASM files over HTTPS.
- Only load trusted `.wasm` binaries.
- Validate all data sent between the main thread and workers.
- Configure proper `Content-Type: application/wasm` headers on the server.
- Consider Content Security Policy (CSP) requirements if your application uses strict security settings.

---

# Browser Support

| Feature              | Chrome | Firefox | Safari  | Edge |
| -------------------- | ------ | ------- | ------- | ---- |
| WebAssembly          | ✅     | ✅      | ✅      | ✅   |
| Web Workers          | ✅     | ✅      | ✅      | ✅   |
| instantiateStreaming | ✅     | ✅      | Partial | ✅   |

---

# Best Practices

- Keep heavy computations inside Web Workers.
- Use Client Components to initialize workers in the App Router.
- Cache instantiated WASM modules for reuse.
- Clean up workers with `worker.terminate()` when no longer needed.
- Validate worker messages and handle errors gracefully.
- Prefer streaming compilation when supported.

---

# Summary

Using WebAssembly with Web Workers in the Next.js App Router enables performant, non-blocking execution of CPU-intensive tasks. The recommended workflow is:

1. Compile source code (e.g., Rust, C++, Zig) into a `.wasm` module.
2. Place the compiled binary in the `public/wasm` directory.
3. Load and instantiate the module inside a Web Worker.
4. Communicate with the worker using `postMessage()`.
5. Update React state with the results in a Client Component.

This architecture keeps the UI responsive while leveraging near-native execution speed for computationally intensive workloads.
