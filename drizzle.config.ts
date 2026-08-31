/**
 * drizzle-kit configuration.
 *
 *   npm run db:generate   — turn schema.ts changes into a SQL migration in /drizzle
 *   npm run db:migrate     — apply pending migrations to DATABASE_URL
 *   npm run db:studio      — browse the database in a local UI
 */

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load the real connection string from .env.local for CLI commands.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
