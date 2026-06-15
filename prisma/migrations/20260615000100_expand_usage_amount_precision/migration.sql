ALTER TABLE "raw_cost_entries"
  ALTER COLUMN "usage_amount" TYPE DECIMAL(30, 10);

ALTER TABLE "billing_line_items"
  ALTER COLUMN "usage_amount" TYPE DECIMAL(30, 10);
