/**
 * Browser factory for the acoustic fingerprint worker (#5312, #5122).
 * Kept in its own module because `import.meta.url` worker URLs are bundler-specific
 * and not loadable under Jest CommonJS; callers and tests can pass `createWorker` to the loader.
 */

export function createAcousticWorker(): Worker {
    return new Worker(new URL('../../workers/acousticFingerprintWorker.ts', import.meta.url), {
        type: 'module'
    });
}
