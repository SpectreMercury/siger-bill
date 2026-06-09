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
  cost_at_list?: number | null;
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

interface BigQueryBillingQuery {
  query: string;
  params: {
    invoiceMonth: string;
    billingAccountIds?: string[];
  };
}

function loadServiceAccountFromEnv(): GcpBigQueryAdapterConfig['credentials'] | undefined {
  const rawJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!rawJson) return undefined;

  const candidates = [
    rawJson,
    Buffer.from(rawJson, 'base64').toString('utf-8'),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
        };
      }
    } catch {
      // Try the next encoding.
    }
  }

  throw new Error('GCP_SERVICE_ACCOUNT_JSON must be valid service account JSON or base64-encoded JSON.');
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

      // BigQuery jobs can run in a different project than the shared billing table.
      const options: Record<string, unknown> = {
        projectId: this.config.jobProjectId || this.config.projectId,
      };

      if (this.config.credentials) {
        options.credentials = this.config.credentials;
      } else {
        const envCredentials = loadServiceAccountFromEnv();
        if (envCredentials) {
          options.credentials = envCredentials;
        }
      }

      if (!options.credentials && this.config.keyFilePath) {
        options.keyFilename = this.config.keyFilePath;
      }

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
    const { query, params: queryParams } = this.buildQuery(
      month,
      accountIds || this.config.billingAccountIds
    );

    // Get BigQuery client
    const bigquery = await this.getBigQueryClient();

    // Execute query
    const [rows] = await bigquery.query({
      query,
      params: queryParams,
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
        queryParams,
        source: `${this.config.projectId}.${this.config.datasetId}.${this.config.tableName}`,
        jobProjectId: this.config.jobProjectId || this.config.projectId,
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
      await bigquery.query({ query, location: 'US' });
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
      WHERE invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY))
      ORDER BY billing_account_id
    `;

    const [rows] = await bigquery.query({ query, location: 'US' });
    return rows as Array<{ id: string; name: string }>;
  }

  /**
   * Build BigQuery SQL for fetching billing data
   */
  private buildQuery(month: string, billingAccountIds?: string[]): BigQueryBillingQuery {
    const [year, monthNum] = month.split('-').map(Number);
    const invoiceMonth = `${year}${String(monthNum).padStart(2, '0')}`;
    const queryParams: BigQueryBillingQuery['params'] = { invoiceMonth };

    let accountFilter = '';
    if (billingAccountIds && billingAccountIds.length > 0) {
      accountFilter = 'AND billing_account_id IN UNNEST(@billingAccountIds)';
      queryParams.billingAccountIds = billingAccountIds;
    }

    const query = `
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
        cost_at_list,
        currency,
        currency_conversion_rate,
        credits,
        invoice,
        cost_type,
        adjustment_info
      FROM \`${this.config.projectId}.${this.config.datasetId}.${this.config.tableName}\`
      WHERE invoice.month = @invoiceMonth
        ${accountFilter}
      ORDER BY usage_start_time
    `;

    return { query, params: queryParams };
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
        listCost: row.cost_at_list != null
          ? new Prisma.Decimal(row.cost_at_list)
          : creditsAmount !== 0
            ? new Prisma.Decimal(row.cost - creditsAmount)
            : undefined,
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
 * Create a GCP BigQuery adapter from a database GcpConnection record.
 * Uses the connection's credentials and billing config.
 */
export function createGcpBigQueryAdapterFromConnection(connection: {
  billingProjectId: string | null;
  billingJobProjectId?: string | null;
  billingDatasetId: string | null;
  billingTableName: string | null;
  billingAccountIds: string[];
  credentials: unknown;
  authType: string;
}): GcpBigQueryAdapter {
  if (!connection.billingProjectId || !connection.billingDatasetId || !connection.billingTableName) {
    throw new Error(
      'GCP connection is missing BigQuery billing config. Set billingProjectId, billingDatasetId, and billingTableName.'
    );
  }

  const config: GcpBigQueryAdapterConfig = {
    projectId: connection.billingProjectId,
    jobProjectId: connection.billingJobProjectId || undefined,
    datasetId: connection.billingDatasetId,
    tableName: connection.billingTableName,
    billingAccountIds: connection.billingAccountIds.length > 0 ? connection.billingAccountIds : undefined,
  };

  if (connection.authType === 'SERVICE_ACCOUNT') {
    const creds = connection.credentials as { client_email: string; private_key: string };
    if (!creds.client_email || !creds.private_key) {
      throw new Error('SERVICE_ACCOUNT credentials must include client_email and private_key.');
    }

    return new GcpBigQueryAdapter({
      ...config,
      credentials: { client_email: creds.client_email, private_key: creds.private_key },
    });
  }

  if (connection.authType === 'APPLICATION_DEFAULT') {
    return new GcpBigQueryAdapter(config);
  }

  throw new Error('BigQuery billing adapter requires SERVICE_ACCOUNT or APPLICATION_DEFAULT auth.');
}

/**
 * Create a GCP BigQuery adapter from environment variables
 */
export function createGcpBigQueryAdapterFromEnv(): GcpBigQueryAdapter {
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const jobProjectId = process.env.GCP_BILLING_JOB_PROJECT_ID;
  const datasetId = process.env.GCP_BILLING_DATASET_ID;
  const tableName = process.env.GCP_BILLING_TABLE_NAME;

  if (!projectId || !datasetId || !tableName) {
    throw new Error(
      'Missing required GCP billing configuration. Set GCP_BILLING_PROJECT_ID, GCP_BILLING_DATASET_ID, and GCP_BILLING_TABLE_NAME environment variables.'
    );
  }

  return new GcpBigQueryAdapter({
    projectId,
    jobProjectId,
    datasetId,
    tableName,
    credentials: loadServiceAccountFromEnv(),
    keyFilePath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    billingAccountIds: process.env.GCP_BILLING_ACCOUNT_IDS?.split(',').map((s) => s.trim()),
  });
}
