CREATE INDEX "billing_line_items_monthly_template_idx"
  ON "billing_line_items"("ingestion_batch_id", "subaccount_id", "usage_start_time", "meter_id");
