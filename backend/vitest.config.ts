import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        setupFiles: ['tests/setup.ts'],
        // Redis-backed helpers are module-level singletons; isolate per file.
        pool: 'forks',
        coverage: {
            provider: 'v8',
            include: ['src/services/**', 'src/middleware/**'],
            reporter: ['text', 'lcov'],
        },
    },
});
