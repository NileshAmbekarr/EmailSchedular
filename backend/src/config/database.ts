import dns from 'node:dns';

// MUST run before the Postgres client is constructed. Supabase's pooler
// resolves to IPv6 first, which Render's network cannot route.
dns.setDefaultResultOrder('ipv4first');

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { env } from './env.js';
import * as schema from '../db/schema.js';

export const client = postgres(env.DATABASE_URL, {
    max: env.IS_TEST ? 1 : 10,
    idle_timeout: 30,
    connect_timeout: 15,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;

export const closeDatabase = async (): Promise<void> => {
    await client.end({ timeout: 5 });
};

/** Used by the readiness probe. */
export const pingDatabase = async (): Promise<boolean> => {
    try {
        await db.execute(sql`select 1`);
        return true;
    } catch {
        return false;
    }
};
