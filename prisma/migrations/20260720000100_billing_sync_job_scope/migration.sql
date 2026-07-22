ALTER TABLE "billing_sync_jobs"
  ADD COLUMN "scope_key" VARCHAR(255),
  ADD COLUMN "scope_connection_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

UPDATE "billing_sync_jobs"
SET "scope_key" = CASE
  WHEN "connection_id" IS NOT NULL THEN 'connection:' || "connection_id"::TEXT
  WHEN "customer_id" IS NOT NULL THEN 'customer:' || "customer_id"::TEXT
  ELSE 'legacy-creator:' || "created_by"::TEXT
END;

UPDATE "billing_sync_jobs"
SET "scope_connection_ids" = ARRAY["connection_id"]::UUID[]
WHERE "connection_id" IS NOT NULL;

UPDATE "billing_sync_jobs" AS job
SET "scope_connection_ids" = ARRAY[customer."gcp_connection_id"]::UUID[]
FROM "customers" AS customer
WHERE job."customer_id" = customer."id"
  AND customer."gcp_connection_id" IS NOT NULL
  AND cardinality(job."scope_connection_ids") = 0;

UPDATE "billing_sync_jobs"
SET
  "status" = 'FAILED'::"billing_sync_job_status",
  "error_message" = 'Legacy billing sync job had no persisted connection scope and must be retried.',
  "errors" = ARRAY['Legacy billing sync job had no persisted connection scope and must be retried.']::TEXT[],
  "finished_at" = CURRENT_TIMESTAMP,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "connection_id" IS NULL
  AND "customer_id" IS NULL
  AND cardinality("scope_connection_ids") = 0
  AND "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "billing_sync_jobs"
  ALTER COLUMN "scope_key" SET NOT NULL;

CREATE INDEX "billing_sync_jobs_scope_key_billing_month_idx"
  ON "billing_sync_jobs"("scope_key", "billing_month");

CREATE INDEX "billing_sync_jobs_scope_connection_ids_gin_idx"
  ON "billing_sync_jobs" USING GIN ("scope_connection_ids");
