// Sieger GCP Reseller Management Console
// Prisma 7 Configuration for Neon Serverless PostgreSQL

import "dotenv/config";
import { defineConfig } from "prisma/config";

// Provide a dummy URL for build time if DATABASE_URL is not set
const databaseUrl = process.env["DATABASE_URL"] || "postgresql://dummy:dummy@localhost:5432/dummy";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
