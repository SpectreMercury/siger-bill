CREATE TYPE "pricing_basis" AS ENUM ('STANDARD', 'COST');

ALTER TABLE "pricing_lists"
ADD COLUMN "price_basis" "pricing_basis";

-- Preserve the previous exporter behavior for existing customers until an
-- administrator explicitly selects the standard/list-price version.
UPDATE "pricing_lists"
SET "price_basis" = 'COST';

ALTER TABLE "pricing_lists"
ALTER COLUMN "price_basis" SET NOT NULL,
ALTER COLUMN "price_basis" SET DEFAULT 'STANDARD';
