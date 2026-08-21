/**
 * Test environment. Values are placeholders — the unit suites exercise pure
 * logic and never open a socket, but `config/env.ts` exits the process if
 * anything required is missing, so it all has to be present.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.ENCRYPTION_KEY ??=
    '0000000000000000000000000000000000000000000000000000000000000001';
process.env.LINK_SECRET ??= 'test-link-secret-value';
process.env.LOG_LEVEL ??= 'silent';
process.env.API_URL ??= 'http://localhost:3001';
process.env.FRONTEND_URL ??= 'http://localhost:3000';
