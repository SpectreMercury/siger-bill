-- Add the global special-rule type used to attribute GCP billing rows whose
-- exported project is NULL. Existing billing rows remain unchanged.
ALTER TYPE "special_rule_type" ADD VALUE IF NOT EXISTS 'ASSIGN_NULL_PROJECT';

CREATE TABLE "special_rule_null_project_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "special_rule_id" UUID NOT NULL,
    "billing_account_id" VARCHAR(100) NOT NULL,
    "sku_id" VARCHAR(100) NOT NULL,
    "project_id" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_rule_null_project_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "special_rule_null_project_mappings_rule_billing_sku_key"
ON "special_rule_null_project_mappings"("special_rule_id", "billing_account_id", "sku_id");

CREATE INDEX "special_rule_null_project_mappings_billing_sku_idx"
ON "special_rule_null_project_mappings"("billing_account_id", "sku_id");

CREATE INDEX "special_rule_null_project_mappings_project_id_idx"
ON "special_rule_null_project_mappings"("project_id");

ALTER TABLE "special_rule_null_project_mappings"
ADD CONSTRAINT "special_rule_null_project_mappings_rule_fkey"
FOREIGN KEY ("special_rule_id") REFERENCES "special_rules"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "special_rule_null_project_mappings"
ADD CONSTRAINT "special_rule_null_project_mappings_billing_account_fkey"
FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("billing_account_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "special_rule_null_project_mappings"
ADD CONSTRAINT "special_rule_null_project_mappings_project_fkey"
FOREIGN KEY ("project_id") REFERENCES "project_billing_configs"("project_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
ADD COLUMN "config_snapshot_id" UUID;

CREATE INDEX "invoices_config_snapshot_id_idx"
ON "invoices"("config_snapshot_id");

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_config_snapshot_id_fkey"
FOREIGN KEY ("config_snapshot_id") REFERENCES "config_snapshots"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
