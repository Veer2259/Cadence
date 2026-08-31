/**
 * db/index.ts — the shared database client.
 *
 * Uses Neon's serverless driver over a WebSocket pool so that transactions work
 * (plan commit needs them). Import `db` anywhere on the server; never from a
 * component that runs in the browser.
 */

import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
export { schema };
