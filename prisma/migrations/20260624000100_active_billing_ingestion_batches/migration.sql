ALTER TABLE "billing_ingestion_batches"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "superseded_at" TIMESTAMPTZ;

CREATE INDEX "billing_ingestion_batches_active_source_idx"
  ON "billing_ingestion_batches"("provider", "source_type", "invoice_month", "is_active");
