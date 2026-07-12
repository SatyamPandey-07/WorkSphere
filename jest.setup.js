import '@testing-library/jest-dom';

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
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
  usePathname: () => '',
}));

// Mock Clerk
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    user: { id: 'test-user', imageUrl: 'https://example.com/avatar.png' },
    isSignedIn: true,
    isLoaded: true,
  }),
  useAuth: () => ({
    userId: 'test-user',
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
  })
);
