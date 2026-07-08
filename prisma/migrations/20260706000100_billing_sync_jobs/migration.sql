CREATE TYPE "billing_sync_job_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "billing_sync_jobs" (
  "id" UUID NOT NULL,
  "billing_month" VARCHAR(7) NOT NULL,
  "connection_id" UUID,
  "customer_id" UUID,
  "status" "billing_sync_job_status" NOT NULL DEFAULT 'QUEUED',
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "batches" JSONB,
  "source_conflict_count" INTEGER NOT NULL DEFAULT 0,
  "source_conflicts" JSONB,
  "errors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "error_message" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_sync_jobs_billing_month_status_idx"
  ON "billing_sync_jobs"("billing_month", "status");
CREATE INDEX "billing_sync_jobs_connection_id_billing_month_idx"
  ON "billing_sync_jobs"("connection_id", "billing_month");
CREATE INDEX "billing_sync_jobs_customer_id_billing_month_idx"
  ON "billing_sync_jobs"("customer_id", "billing_month");
CREATE INDEX "billing_sync_jobs_created_by_idx"
  ON "billing_sync_jobs"("created_by");
CREATE INDEX "billing_sync_jobs_created_at_idx"
  ON "billing_sync_jobs"("created_at");

ALTER TABLE "billing_sync_jobs"
  ADD CONSTRAINT "billing_sync_jobs_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "gcp_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_sync_jobs"
  ADD CONSTRAINT "billing_sync_jobs_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_sync_jobs"
  ADD CONSTRAINT "billing_sync_jobs_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
