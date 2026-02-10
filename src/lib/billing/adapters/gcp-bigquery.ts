/**
 * GCP BigQuery Billing Adapter (Phase 5)
 *
 * Fetches billing data from GCP BigQuery billing export tables
 * and normalizes it into unified BillingLineItem format.
 *
 * Note: Requires @google-cloud/bigquery package to be installed:
 *   npm install @google-cloud/bigquery
 */

import { BillingProvider, BillingSourceType, Prisma } from '@prisma/client';
import {
  BillingSourceAdapter,
  BillingLineItemDTO,
  FetchLineItemsParams,
  FetchLineItemsResult,
  GcpBigQueryAdapterConfig,
  createLineItemsChecksum,
} from './types';

// BigQuery types - defined locally to avoid requiring the package at compile time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BigQueryClient = any;

/**
 * Raw row from GCP BigQuery billing export
 */
interface GcpBillingExportRow {
  billing_account_id: string;
  service: {
    id: string;
    description: string;
  };
  sku: {
    id: string;
    description: string;
  };
  usage_start_time: { value: string };
  usage_end_time: { value: string };
  project: {
    id: string;
    name: string;
    labels: Array<{ key: string; value: string }>;
  } | null;
  labels: Array<{ key: string; value: string }> | null;
  system_labels: Array<{ key: string; value: string }> | null;
  location: {
    location: string;
    country: string;
    region: string;
    zone: string;
  } | null;
  resource: {
    name: string;
    global_name: string;
  } | null;
  usage: {
    amount: number;
    unit: string;
    amount_in_pricing_units: number;
    pricing_unit: string;
  };
  cost: number;
  currency: string;
  currency_conversion_rate: number;
  credits: Array<{
    name: string;
    amount: number;
    full_name: string;
    id: string;
    type: string;
  }> | null;
  invoice: {
    month: string;
  };
  cost_type: string;
  adjustment_info: {
    id: string;
    description: string;
    mode: string;
    type: string;
  } | null;
}

export class GcpBigQueryAdapter implements BillingSourceAdapter {
  readonly provider = BillingProvider.GCP;
  readonly sourceType = BillingSourceType.BIGQUERY_EXPORT;

  private bigquery: BigQueryClient | null = null;
  private config: GcpBigQueryAdapterConfig;

  constructor(config: GcpBigQueryAdapterConfig) {
    this.config = config;
  }

  /**
   * Initialize BigQuery client (lazy loading)
   */
  private async getBigQueryClient(): Promise<BigQueryClient> {
    if (this.bigquery) {
      return this.bigquery;
    }

    try {
      // Dynamic require to allow running without @google-cloud/bigquery installed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bigqueryModule = require('@google-cloud/bigquery');
      const BigQuery = bigqueryModule.BigQuery;

      const options = {
        projectId: this.config.projectId,
        keyFilename: this.config.keyFilePath,
      };

      this.bigquery = new BigQuery(options);
      return this.bigquery;
    } catch {
      throw new Error(
        'Failed to initialize BigQuery client. Ensure @google-cloud/bigquery is installed: npm install @google-cloud/bigquery'
      );
    }
  }

  async fetchLineItems(params: FetchLineItemsParams): Promise<FetchLineItemsResult> {
    const { month, accountIds, options } = params;

    // Build the query
    const query = this.buildQuery(month, accountIds || this.config.billingAccountIds);

    // Get BigQuery client
    const bigquery = await this.getBigQueryClient();

    // Execute query
    const [rows] = await bigquery.query({
      query,
      location: 'US', // BigQuery billing exports are typically in US
      ...(options?.maxResults ? { maxResults: options.maxResults as number } : {}),
    });

    // Normalize rows to BillingLineItemDTO
    const lineItems = this.normalizeRows(rows as GcpBillingExportRow[], month);

    // Calculate checksum
    const checksum = createLineItemsChecksum(lineItems);

    return {
      lineItems,
      rowCount: lineItems.length,
      checksum,
      sourceMetadata: {
        query,
        source: `${this.config.projectId}.${this.config.datasetId}.${this.config.tableName}`,
        dataRange: {
          start: `${month}-01`,
          end: this.getMonthEndDate(month),
        },
        billingAccountIds: accountIds || this.config.billingAccountIds,
        warnings: rows.length === 0 ? ['No billing data found for the specified period'] : undefined,
      },
    };
  }

  async validateConnection(): Promise<boolean> {
    try {
      const bigquery = await this.getBigQueryClient();
      const query = `
        SELECT 1
        FROM \`${this.config.projectId}.${this.config.datasetId}.${this.config.tableName}\`
        LIMIT 1
      `;
      await bigquery.query({ query });
      return true;
    } catch (error) {
      console.error('GCP BigQuery connection validation failed:', error);
      return false;
    }
  }

  async listAccounts(): Promise<Array<{ id: string; name: string }>> {
    const bigquery = await this.getBigQueryClient();
    const query = `
      SELECT DISTINCT
        billing_account_id as id,
        billing_account_id as name
      FROM \`${this.config.projectId}.${this.config.datasetId}.${this.config.tableName}\`
      WHERE _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    `;

    const [rows] = await bigquery.query({ query });
    return rows as Array<{ id: string; name: string }>;
  }

  /**
   * Build BigQuery SQL for fetching billing data
   */
  private buildQuery(month: string, billingAccountIds?: string[]): string {
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = this.getMonthEndDate(month);

    let accountFilter = '';
    if (billingAccountIds && billingAccountIds.length > 0) {
      const accounts = billingAccountIds.map((a) => `'${a}'`).join(', ');
      accountFilter = `AND billing_account_id IN (${accounts})`;
    }

    return `
      SELECT
        billing_account_id,
        service,
        sku,
        usage_start_time,
        usage_end_time,
        project,
        labels,
        system_labels,
        location,
        resource,
        usage,
        cost,
        currency,
        currency_conversion_rate,
        credits,
        invoice,
        cost_type,
        adjustment_info
      FROM \`${this.config.projectId}.${this.config.datasetId}.${this.config.tableName}\`
      WHERE invoice.month = '${year}${String(monthNum).padStart(2, '0')}'
        AND usage_start_time >= TIMESTAMP('${startDate}')
        AND usage_start_time < TIMESTAMP('${endDate}') + INTERVAL 1 DAY
        ${accountFilter}
      ORDER BY usage_start_time
    `;
  }

  /**
   * Normalize GCP billing export rows to unified BillingLineItemDTO
   */
  private normalizeRows(rows: GcpBillingExportRow[], month: string): BillingLineItemDTO[] {
    return rows.map((row) => {
      // Convert labels array to object
      const tags: Record<string, string> = {};
      if (row.labels) {
        for (const label of row.labels) {
          tags[label.key] = label.value;
        }
      }
      if (row.project?.labels) {
        for (const label of row.project.labels) {
          tags[`project_${label.key}`] = label.value;
        }
      }

      // Calculate total credits
      let creditsAmount = 0;
      if (row.credits) {
        creditsAmount = row.credits.reduce((sum, credit) => sum + credit.amount, 0);
      }

      return {
        provider: BillingProvider.GCP,
        sourceType: BillingSourceType.BIGQUERY_EXPORT,

        // Account hierarchy
        accountId: row.billing_account_id,
        subaccountId: row.project?.id || undefined,
        resourceId: row.resource?.name || undefined,

        // Product identification
        productId: row.service.id,
        meterId: row.sku.id,

        // Usage metrics
        usageAmount: new Prisma.Decimal(row.usage.amount || 0),
        usageUnit: row.usage.unit || 'unknown',

        // Cost data (cost already includes credits in GCP export)
        cost: new Prisma.Decimal(row.cost),
        listCost: creditsAmount !== 0 ? new Prisma.Decimal(row.cost - creditsAmount) : undefined,
        currency: row.currency,

        // Time range
        usageStartTime: new Date(row.usage_start_time.value),
        usageEndTime: new Date(row.usage_end_time.value),
        invoiceMonth: month,

        // Optional metadata
        region: row.location?.region || undefined,
        tags: Object.keys(tags).length > 0 ? tags : undefined,

        // Raw payload for audit
        rawPayload: row,
      };
    });
  }

  /**
   * Get the last day of a month in YYYY-MM-DD format
   */
  private getMonthEndDate(month: string): string {
    const [year, monthNum] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNum, 0).getDate();
    return `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }
}

/**
 * Create a GCP BigQuery adapter from environment variables
 */
export function createGcpBigQueryAdapterFromEnv(): GcpBigQueryAdapter {
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const datasetId = process.env.GCP_BILLING_DATASET_ID;
  const tableName = process.env.GCP_BILLING_TABLE_NAME;

  if (!projectId || !datasetId || !tableName) {
    throw new Error(
      'Missing required GCP billing configuration. Set GCP_BILLING_PROJECT_ID, GCP_BILLING_DATASET_ID, and GCP_BILLING_TABLE_NAME environment variables.'
    );
  }

  return new GcpBigQueryAdapter({
    projectId,
    datasetId,
    tableName,
    keyFilePath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    billingAccountIds: process.env.GCP_BILLING_ACCOUNT_IDS?.split(',').map((s) => s.trim()),
  });
}
