// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // snarkjs/ffjavascript resolve to browser ESM under jsdom — pin CJS for tests
    '^snarkjs$': '<rootDir>/node_modules/snarkjs/build/main.cjs',
    '^ffjavascript$': '<rootDir>/node_modules/ffjavascript/build/main.cjs',
    // @google/genai resolves to a browser ESM bundle under jsdom; pin the Node
    // CJS build so route handlers that import the Gemini client can load it.
    '^@google/genai$': '<rootDir>/node_modules/@google/genai/dist/node/index.cjs',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/.kilo/', 'e2e'],
  // Canvas/WebGL/WASM-heavy suites accumulate memory across test files within
  // a worker; recycle a worker once it grows past this instead of letting it
  // run out of heap partway through the full suite. Capping workers keeps
  // total concurrent memory demand within reach of typical CI/dev machines.
  workerIdleMemoryLimit: '256MB',
  maxWorkers: '50%',
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
};

module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  return {
    ...config,
    transform: {
      '^.+\\.(ts|tsx)$': [
        'ts-jest',
        { tsconfig: { jsx: 'react-jsx', rootDir: '.' } },
      ],
    },
  };
};
