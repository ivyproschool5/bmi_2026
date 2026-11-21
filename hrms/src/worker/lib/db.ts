import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

// Workers cannot keep a connection open between requests, so each request opens
// one connection and closes it when the response is done. Add Cloudflare
// Hyperdrive later to pool connections; the code reads its connection string first.
export function createDb(env: Env) {
  const url = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1, fetch_types: false, prepare: false });
  return { db: drizzle(sql, { schema }), sql };
}

export type DB = ReturnType<typeof createDb>['db'];
