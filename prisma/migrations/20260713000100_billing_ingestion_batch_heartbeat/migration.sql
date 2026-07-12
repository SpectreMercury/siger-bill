ALTER TABLE "billing_ingestion_batches"
ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "billing_ingestion_batches"
ALTER COLUMN "updated_at" DROP DEFAULT;
