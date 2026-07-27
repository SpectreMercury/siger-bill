import assert from 'node:assert/strict';
import { GcpBigQueryAdapter } from '../src/lib/billing/adapters/gcp-bigquery';

const adapter = new GcpBigQueryAdapter({
  projectId: 'billing-project',
  datasetId: 'billing_dataset',
  tableName: 'gcp_billing_export_v1_test',
});

const { query } = (
  adapter as unknown as {
    buildQuery(month: string, billingAccountIds?: string[]): {
      query: string;
      params: { invoiceMonth: string; billingAccountIds?: string[] };
    };
  }
).buildQuery('2026-06');

assert.doesNotMatch(
  query,
  /'AGGREGATED'\s+AS type/,
  'monthly BigQuery aggregation must not replace GCP credit categories with AGGREGATED'
);
assert.match(
  query,
  /ARRAY_CONCAT_AGG\(IFNULL\(billing\.credits,\s*\[\]\)\)\s+AS credit_entries/,
  'monthly BigQuery aggregation must retain the source credit entries'
);
assert.match(
  query,
  /GROUP BY credit\.type/,
  'monthly BigQuery aggregation must aggregate credits independently by GCP credit type'
);
assert.match(
  query,
  /credit\.type AS type/,
  'the normalized credit breakdown must expose the original GCP credit type'
);

console.log('GCP credit type preservation checks passed');
