import type { Logger } from 'pino';

/**
 * Unhandled-rejection reporting that does not cry wolf.
 *
 * Two problems this fixes, both visible in the Render boot logs:
 *
 *  1. `logger.error({ reason }, ...)` printed `"reason":{}`. Pino only applies
 *     its error serializer to the `err` key, so an Error logged under any other
 *     name serialises to an empty object — the stack and message were lost
 *     exactly when they were needed.
 *
 *  2. Ten "unhandled promise rejection" errors fired on every boot, followed by
 *     `PromiseRejectionHandledWarning`. That warning means the promises *were*
 *     handled, just on a later tick — ioredis and BullMQ attach `.catch()`
 *     asynchronously while retrying the initial connection. Reporting those at
 *     error level makes a healthy start look broken.
 *
 * So: hold a rejection briefly, and only report it if no handler shows up.
 */

/** How long to wait for a late `.catch()` before treating it as a real fault. */
const GRACE_MS = 1_000;

export const installRejectionHandlers = (logger: Logger): void => {
    const pending = new Map<Promise<unknown>, NodeJS.Timeout>();

    process.on('unhandledRejection', (reason, promise) => {
        const timer = setTimeout(() => {
            pending.delete(promise);
            // `err` so pino's standard serializer renders message + stack.
            logger.error({ err: reason }, 'unhandled promise rejection');
        }, GRACE_MS);

        // Never let this timer hold the process open during shutdown.
        timer.unref();
        pending.set(promise, timer);
    });

    process.on('rejectionHandled', (promise) => {
        const timer = pending.get(promise);
        if (!timer) return;

        clearTimeout(timer);
        pending.delete(promise);
        logger.debug('promise rejection was handled asynchronously');
    });
};
