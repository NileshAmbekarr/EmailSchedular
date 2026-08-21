/**
 * Applies committed SQL migrations from ./drizzle.
 * Run on deploy: `npm run db:migrate`.
 *
 * This replaces `drizzle-kit push`, which diffs the schema against the live
 * database and applies changes without a reviewable, ordered history — fine for
 * a scratch database, dangerous once there is real data.
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDatabase } from '../config/database.js';
import { log } from '../config/logger.js';

const logger = log('migrate');

const run = async () => {
    logger.info('applying migrations');
    await migrate(db, { migrationsFolder: './drizzle' });
    logger.info('migrations applied');
    await closeDatabase();
};

run().catch(async (err) => {
    logger.error({ err }, 'migration failed');
    await closeDatabase().catch(() => {});
    process.exit(1);
});
