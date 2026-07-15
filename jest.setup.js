import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "util";
import { webcrypto } from "crypto";
// jsdom doesn't provide these globals; Node's implementations are drop-in
// replacements and let us test Edge-runtime-style code (e.g. src/lib/csrf.ts)
// under the standard jsdom test environment.
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  Request: UndiciRequest,
  Response: UndiciResponse,
  Headers: UndiciHeaders,
  FormData: UndiciFormData,
  File: UndiciFile,
} = require("undici");
/* eslint-enable @typescript-eslint/no-require-imports */

if (typeof global.Request === "undefined") {
  global.Request = UndiciRequest;
}
if (typeof global.Response === "undefined") {
  global.Response = UndiciResponse;
}
if (typeof global.Headers === "undefined") {
  global.Headers = UndiciHeaders;
}
if (typeof global.FormData === "undefined") {
  global.FormData = UndiciFormData;
}
if (typeof global.File === "undefined") {
  global.File = UndiciFile;
}
if (typeof global.crypto === "undefined" || !global.crypto.subtle) {
  Object.defineProperty(global, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
if (typeof global.structuredClone === "undefined") {
  global.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
import "fake-indexeddb/auto";

// Mock Leaflet global variable L
global.L = {
  map: jest.fn().mockReturnValue({
    setView: jest.fn().mockReturnThis(),
    on: jest.fn(),
    remove: jest.fn(),
  }),
  tileLayer: jest.fn().mockReturnValue({
    addTo: jest.fn(),
  }),
  marker: jest.fn().mockReturnValue({
    addTo: jest.fn().mockReturnThis(),
    bindPopup: jest.fn().mockReturnThis(),
  }),
  divIcon: jest.fn(),
  heatLayer: jest.fn().mockReturnValue({
    addTo: jest.fn(),
  }),
  extend: jest.fn(),
  Class: {
    extend: jest.fn().mockReturnThis(),
  },
  Layer: {
    extend: jest.fn().mockReturnThis(),
  },
};

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
  usePathname: () => "",
}));

// Mock Clerk
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { id: "test-user", imageUrl: "https://example.com/avatar.png" },
    isSignedIn: true,
    isLoaded: true,
  }),
  useAuth: () => ({
    userId: "test-user",
    isSignedIn: true,
  }),
  SignInButton: ({ children }) => children,
  SignUpButton: ({ children }) => children,
  SignedIn: ({ children }) => children,
  SignedOut: () => null,
  UserButton: () => null,
}));

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }),
);
