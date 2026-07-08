-- Align credit_type with the approved six GCP credit categories.
-- Existing legacy SUBSCRIPTION_BENEFIT values are treated as generic discounts.
UPDATE "credits"
SET "types" = array_replace("types", 'SUBSCRIPTION_BENEFIT'::"credit_type", 'DISCOUNT'::"credit_type")
WHERE 'SUBSCRIPTION_BENEFIT'::"credit_type" = ANY("types");

ALTER TYPE "credit_type" RENAME TO "credit_type_old";

CREATE TYPE "credit_type" AS ENUM (
  'FEE_UTILIZATION_OFFSET',
  'DISCOUNT',
  'SUSTAINED_USAGE_DISCOUNT',
  'COMMITTED_USAGE_DISCOUNT',
  'COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE',
  'PROMOTION'
);

ALTER TABLE "credits"
  ALTER COLUMN "types" DROP DEFAULT,
  ALTER COLUMN "types" TYPE "credit_type"[] USING ("types"::text[]::"credit_type"[]),
  ALTER COLUMN "types" SET DEFAULT ARRAY[]::"credit_type"[];

DROP TYPE "credit_type_old";

ALTER TABLE "billing_line_items"
  ADD COLUMN "billing_account_name" VARCHAR(255),
  ADD COLUMN "project_name" VARCHAR(255),
  ADD COLUMN "service_description" VARCHAR(255),
  ADD COLUMN "sku_description" VARCHAR(500),
  ADD COLUMN "pricing_usage_amount" DECIMAL(30, 10),
  ADD COLUMN "pricing_usage_unit" VARCHAR(50),
  ADD COLUMN "credit_amount" DECIMAL(18, 10) NOT NULL DEFAULT 0,
  ADD COLUMN "cost_after_credit" DECIMAL(18, 10),
  ADD COLUMN "currency_conversion_rate" DECIMAL(18, 10),
  ADD COLUMN "credit_breakdown" JSONB,
  ADD COLUMN "transaction_type" VARCHAR(100);

CREATE INDEX "billing_line_items_transaction_type_idx" ON "billing_line_items"("transaction_type");
