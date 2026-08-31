/**
 * Side-effect module: load .env.local for standalone scripts (seed, inspections).
 * Import this FIRST — before any module that reads process.env at import time —
 * because ES import evaluation runs before plain top-level statements.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
