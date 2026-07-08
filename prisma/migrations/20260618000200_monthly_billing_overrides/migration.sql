CREATE TABLE "billing_monthly_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "billing_month" VARCHAR(7) NOT NULL,
  "customer_id" UUID,
  "billing_ingestion_batch_id" UUID NOT NULL,
  "source_filename" VARCHAR(255) NOT NULL,
  "source_file_hash" VARCHAR(64) NOT NULL,
  "row_count" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "uploaded_by" UUID NOT NULL,
  "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivated_at" TIMESTAMPTZ,
  CONSTRAINT "billing_monthly_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_monthly_override_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "override_id" UUID NOT NULL,
  "row_number" INTEGER NOT NULL,
  "customer_id" UUID,
  "company_name" VARCHAR(255),
  "billing_account_id" VARCHAR(100) NOT NULL,
  "billing_account_name" VARCHAR(255),
  "project_name" VARCHAR(255),
  "project_id" VARCHAR(100),
  "service_description" VARCHAR(255),
  "service_id" VARCHAR(100) NOT NULL,
  "sku_description" VARCHAR(500),
  "sku_id" VARCHAR(100) NOT NULL,
  "usage_start_time" TIMESTAMPTZ NOT NULL,
  "usage_end_time" TIMESTAMPTZ NOT NULL,
  "usage_amount" DECIMAL(30, 10) NOT NULL,
  "usage_unit" VARCHAR(50) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "list_cost" DECIMAL(18, 10),
  "reseller_cost" DECIMAL(18, 10) NOT NULL,
  "credit_amount" DECIMAL(18, 10) NOT NULL DEFAULT 0,
  "cost_after_credit" DECIMAL(18, 10),
  "discount_price" VARCHAR(100),
  "final_amount" DECIMAL(18, 10),
  "cny_amount" DECIMAL(18, 10),
  "transaction_type" VARCHAR(100),
  "currency_conversion_rate" DECIMAL(18, 10),
  "row_data" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_monthly_override_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_monthly_overrides_billing_ingestion_batch_id_key"
  ON "billing_monthly_overrides"("billing_ingestion_batch_id");
CREATE UNIQUE INDEX "billing_monthly_overrides_active_scope_key"
  ON "billing_monthly_overrides"(
    "billing_month",
    COALESCE("customer_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "is_active" = true;

CREATE INDEX "billing_monthly_overrides_billing_month_customer_id_is_active_idx"
  ON "billing_monthly_overrides"("billing_month", "customer_id", "is_active");
CREATE INDEX "billing_monthly_overrides_uploaded_by_idx"
  ON "billing_monthly_overrides"("uploaded_by");
CREATE INDEX "billing_monthly_override_lines_override_id_idx"
  ON "billing_monthly_override_lines"("override_id");
CREATE INDEX "billing_monthly_override_lines_customer_id_idx"
  ON "billing_monthly_override_lines"("customer_id");
CREATE INDEX "billing_monthly_override_lines_project_id_idx"
  ON "billing_monthly_override_lines"("project_id");

ALTER TABLE "billing_monthly_overrides"
  ADD CONSTRAINT "billing_monthly_overrides_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_monthly_overrides"
  ADD CONSTRAINT "billing_monthly_overrides_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_monthly_overrides"
  ADD CONSTRAINT "billing_monthly_overrides_billing_ingestion_batch_id_fkey"
  FOREIGN KEY ("billing_ingestion_batch_id") REFERENCES "billing_ingestion_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_monthly_override_lines"
  ADD CONSTRAINT "billing_monthly_override_lines_override_id_fkey"
  FOREIGN KEY ("override_id") REFERENCES "billing_monthly_overrides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_monthly_override_lines"
  ADD CONSTRAINT "billing_monthly_override_lines_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
