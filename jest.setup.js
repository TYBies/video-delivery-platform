// Optional: configure or set up a testing framework before each test.
// If you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
// Only load jest-dom in environments that provide the DOM (jsdom)
try {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line import/no-extraneous-dependencies, @typescript-eslint/no-require-imports
    require('@testing-library/jest-dom');
  }
} catch {
  // Ignore if not available in this environment
}

// Mock console methods to prevent Jest from failing on console.error/warn
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};
