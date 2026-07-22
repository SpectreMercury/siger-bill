-- Add richer Project billing classification while retaining the legacy
-- `billable` flag used by the invoice pipeline.
CREATE TYPE "project_charge_type" AS ENUM (
  'BILLABLE',
  'NON_BILLABLE',
  'CUD',
  'POC',
  'STARTUP'
);

ALTER TABLE "project_billing_configs"
ADD COLUMN "charge_type" "project_charge_type" NOT NULL DEFAULT 'BILLABLE';

UPDATE "project_billing_configs"
SET "charge_type" = CASE
  WHEN "billable" THEN 'BILLABLE'::"project_charge_type"
  ELSE 'NON_BILLABLE'::"project_charge_type"
END;

CREATE INDEX "project_billing_configs_charge_type_idx"
ON "project_billing_configs"("charge_type");

-- An empty array means that the pricing list applies to every Billing ID.
ALTER TABLE "pricing_lists"
ADD COLUMN "billing_account_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Persist the workbook shape so historical STANDARD overrides can be rendered
-- without dropping fields that do not exist in the COST template.
ALTER TABLE "billing_monthly_overrides"
ADD COLUMN "price_basis" "pricing_basis" NOT NULL DEFAULT 'COST';

ALTER TYPE "credit_type" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_BENEFIT';
