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
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', 'e2e'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
};

module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  config.transform = {
    '^.+\\.(ts|tsx|js|jsx)$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  };
  return config;
};
