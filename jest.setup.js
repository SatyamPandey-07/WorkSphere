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

/* eslint-disable @typescript-eslint/no-require-imports, react/display-name */
// Mock @react-leaflet/core and react-leaflet
jest.mock("@react-leaflet/core", () => {
  const React = require("react");
  return {
    createLayerComponent: () => () =>
      React.createElement("div", { "data-testid": "heatmap-overlay" }),
  };
});
jest.mock("react-leaflet", () => {
  const React = require("react");
  const LayersControlMock = ({ children }) =>
    React.createElement("div", { "data-testid": "layers-control" }, children);
  LayersControlMock.BaseLayer = ({ children }) =>
    React.createElement("div", { "data-testid": "base-layer" }, children);
  LayersControlMock.Overlay = ({ children }) =>
    React.createElement("div", { "data-testid": "overlay" }, children);

  return {
    __esModule: true,
    MapContainer: ({ children }) =>
      React.createElement("div", { "data-testid": "map-container" }, children),
    TileLayer: () =>
      React.createElement("div", { "data-testid": "tile-layer" }),
    Marker: ({ children }) =>
      React.createElement("div", { "data-testid": "marker" }, children),
    Popup: ({ children }) =>
      React.createElement("div", { "data-testid": "popup" }, children),
    Polyline: () => React.createElement("div", { "data-testid": "polyline" }),
    useMap: () => ({
      setView: jest.fn(),
      on: jest.fn(),
    }),
    LayersControl: LayersControlMock,
  };
});
/* eslint-enable @typescript-eslint/no-require-imports, react/display-name */

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

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "test-user" }),
  currentUser: jest.fn().mockResolvedValue({ id: "test-user" }),
}));

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }),
);

// Mock groq-sdk
jest.mock("groq-sdk", () => {
  const GroqMock = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: "" } }],
        }),
      },
    },
  }));
  return {
    __esModule: true,
    default: GroqMock,
    Groq: GroqMock,
  };
});

// Mock IntersectionObserver for JSDOM testing environment
global.IntersectionObserver = class IntersectionObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};

