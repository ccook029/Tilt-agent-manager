import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  // Social Studio (native module) schema — the only Drizzle/Postgres surface
  // in the hub; everything else runs on Vercel KV.
  schema: "./src/lib/social/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
