CREATE TABLE "credit_balance_adjustments" (
    "id" UUID NOT NULL,
    "credit_id" UUID NOT NULL,
    "amount_delta" DECIMAL(18,4) NOT NULL,
    "remaining_before" DECIMAL(18,4) NOT NULL,
    "remaining_after" DECIMAL(18,4) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "adjusted_by" UUID NOT NULL,
    "adjusted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_balance_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_balance_adjustments_balance_check"
      CHECK ("remaining_after" = "remaining_before" + "amount_delta")
);

CREATE INDEX "credit_balance_adjustments_credit_id_adjusted_at_idx"
ON "credit_balance_adjustments"("credit_id", "adjusted_at");

CREATE INDEX "credit_balance_adjustments_adjusted_by_idx"
ON "credit_balance_adjustments"("adjusted_by");

ALTER TABLE "credit_balance_adjustments"
ADD CONSTRAINT "credit_balance_adjustments_credit_id_fkey"
FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credit_balance_adjustments"
ADD CONSTRAINT "credit_balance_adjustments_adjusted_by_fkey"
FOREIGN KEY ("adjusted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
