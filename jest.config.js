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
    '^uncrypto$': '<rootDir>/node_modules/uncrypto/dist/crypto.node.cjs',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', 'e2e'],
  // Canvas/WebGL/WASM-heavy suites accumulate memory across test files within
  // a worker; recycle a worker once it grows past this instead of letting it
  // run out of heap partway through the full suite. Capping workers keeps
  // total concurrent memory demand within reach of typical CI/dev machines.
  workerIdleMemoryLimit: '512MB',
  maxWorkers: '50%',
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
};

module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  return config;
};
