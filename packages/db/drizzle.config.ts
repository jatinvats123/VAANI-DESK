import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load repo-root .env first (single source of local config), then package-local overrides.
config({ path: "../../.env" });
config();

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://vaanidesk:vaanidesk@localhost:5432/vaanidesk",
  },
  strict: true,
  verbose: true,
});
