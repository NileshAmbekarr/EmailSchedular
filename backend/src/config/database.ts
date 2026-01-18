import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env.js';
import * as schema from '../db/schema.js';

// Create postgres connection
const connectionString = env.DATABASE_URL;

// For migrations and queries
const client = postgres(connectionString);

// Create drizzle instance with schema
export const db = drizzle(client, { schema });

export type Database = typeof db;
