/**
 * AWS Cost & Usage Report (CUR) Adapter (Phase 5)
 *
 * Fetches billing data from AWS CUR files in S3 or via Athena
 * and normalizes it into unified BillingLineItem format.
 *
 * Note: This is a structural implementation. Real CUR integration
 * requires AWS SDK setup and S3/Athena access configuration.
 */

import { BillingProvider, BillingSourceType, Prisma } from '@prisma/client';
import {
  BillingSourceAdapter,
  BillingLineItemDTO,
  FetchLineItemsParams,
  FetchLineItemsResult,
  AwsCurAdapterConfig,
  createLineItemsChecksum,
} from './types';

/**
 * Raw row from AWS CUR (Cost & Usage Report)
 * Based on AWS CUR 2.0 schema
 */
export interface AwsCurRow {
  // Identity columns
  identity_line_item_id: string;
  identity_time_interval: string;

  // Bill columns
  bill_invoice_id: string;
  bill_invoicing_entity: string;
  bill_billing_entity: string;
  bill_bill_type: string;
  bill_payer_account_id: string;
  bill_billing_period_start_date: string;
  bill_billing_period_end_date: string;

  // Line item columns
  line_item_usage_account_id: string;
  line_item_line_item_type: string;
  line_item_usage_start_date: string;
  line_item_usage_end_date: string;
  line_item_product_code: string;
  line_item_usage_type: string;
  line_item_operation: string;
  line_item_availability_zone: string;
  line_item_resource_id: string;
  line_item_usage_amount: number;
  line_item_normalization_factor: number;
  line_item_normalized_usage_amount: number;
  line_item_currency_code: string;
  line_item_unblended_rate: number;
  line_item_unblended_cost: number;
  line_item_blended_rate: number;
  line_item_blended_cost: number;
  line_item_line_item_description: string;

  // Product columns
  product_product_name: string;
  product_product_family: string;
  product_servicecode: string;
  product_region: string;
  product_instance_type: string;
  product_instance_type_family: string;

  // Pricing columns
  pricing_rate_code: string;
  pricing_rate_id: string;
  pricing_currency: string;
  pricing_public_on_demand_cost: number;
  pricing_public_on_demand_rate: number;
  pricing_term: string;
  pricing_unit: string;

  // Reservation columns (for RI/SP)
  reservation_reservation_arn: string;
  reservation_total_reserved_units: number;
  reservation_total_reserved_normalized_units: number;
  reservation_unused_quantity: number;
  reservation_unused_normalized_unit_quantity: number;

  // Savings plan columns
  savings_plan_savings_plan_arn: string;
  savings_plan_savings_plan_rate: number;
  savings_plan_used_commitment: number;
  savings_plan_savings_plan_effective_cost: number;
  savings_plan_total_commitment_to_date: number;

  // Resource tags (dynamic columns with prefix resource_tags_)
  [key: string]: unknown;
}

export class AwsCurAdapter implements BillingSourceAdapter {
  readonly provider = BillingProvider.AWS;
  readonly sourceType = BillingSourceType.CUR_S3;

  private config: AwsCurAdapterConfig;

  constructor(config: AwsCurAdapterConfig) {
    this.config = config;
  }

  async fetchLineItems(params: FetchLineItemsParams): Promise<FetchLineItemsResult> {
    const { month, accountIds } = params;

    // In a real implementation, this would:
    // 1. List CUR files in S3 for the given month
    // 2. Download and parse the CSV/Parquet files
    // OR
    // 3. Query Athena if configured

    // For now, return a mock structure showing the expected output
    const rows = await this.fetchFromSource(month, accountIds);
    const lineItems = this.normalizeRows(rows, month);
    const checksum = createLineItemsChecksum(lineItems);

    return {
      lineItems,
      rowCount: lineItems.length,
      checksum,
      sourceMetadata: {
        source: this.config.athenaTable
          ? `athena://${this.config.athenaDatabase}.${this.config.athenaTable}`
          : `s3://${this.config.s3Bucket}/${this.config.s3Prefix}`,
        dataRange: {
          start: `${month}-01`,
          end: this.getMonthEndDate(month),
        },
        payerAccountIds: accountIds || this.config.payerAccountIds,
        curVersion: '2.0',
      },
    };
  }

  async validateConnection(): Promise<boolean> {
    // In a real implementation, this would:
    // 1. Check S3 bucket access
    // 2. Verify CUR files exist
    // 3. Or validate Athena table exists

    try {
      // Placeholder - would use AWS SDK
      console.log('AWS CUR connection validation - placeholder');
      return true;
    } catch (error) {
      console.error('AWS CUR connection validation failed:', error);
      return false;
    }
  }

  async listAccounts(): Promise<Array<{ id: string; name: string }>> {
    // In a real implementation, query for distinct payer accounts
    // from the CUR data

    // Placeholder
    return [];
  }

  /**
   * Fetch CUR data from S3 or Athena
   * This is a placeholder - real implementation would use AWS SDK
   */
  private async fetchFromSource(
    month: string,
    accountIds?: string[]
  ): Promise<AwsCurRow[]> {
    // Real implementation would:
    // 1. Use AWS SDK S3 client to list/download CUR files
    // 2. Parse CSV/Parquet files
    // 3. Or use Athena client to query

    console.log(`Fetching AWS CUR data for month: ${month}, accounts: ${accountIds?.join(', ') || 'all'}`);

    // Return empty array - this is structural only
    return [];
  }

  /**
   * Normalize AWS CUR rows to unified BillingLineItemDTO
   */
  private normalizeRows(rows: AwsCurRow[], month: string): BillingLineItemDTO[] {
    return rows.map((row) => {
      // Extract resource tags (columns starting with resource_tags_)
      const tags: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key.startsWith('resource_tags_') && value) {
          const tagKey = key.replace('resource_tags_user_', '').replace('resource_tags_', '');
          tags[tagKey] = String(value);
        }
      }

      // Determine the effective cost (consider savings plans, RIs)
      let effectiveCost = row.line_item_unblended_cost;
      if (row.savings_plan_savings_plan_effective_cost) {
        effectiveCost = row.savings_plan_savings_plan_effective_cost;
      }

      return {
        provider: BillingProvider.AWS,
        sourceType: BillingSourceType.CUR_S3,

        // Account hierarchy
        accountId: row.bill_payer_account_id,
        subaccountId: row.line_item_usage_account_id,
        resourceId: row.line_item_resource_id || undefined,

        // Product identification
        productId: row.line_item_product_code,
        meterId: row.line_item_usage_type,

        // Usage metrics
        usageAmount: new Prisma.Decimal(row.line_item_usage_amount || 0),
        usageUnit: row.pricing_unit || 'unknown',

        // Cost data
        cost: new Prisma.Decimal(effectiveCost),
        listCost: row.pricing_public_on_demand_cost
          ? new Prisma.Decimal(row.pricing_public_on_demand_cost)
          : undefined,
        currency: row.line_item_currency_code,

        // Time range
        usageStartTime: new Date(row.line_item_usage_start_date),
        usageEndTime: new Date(row.line_item_usage_end_date),
        invoiceMonth: month,

        // Optional metadata
        region: row.product_region || undefined,
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

  /**
   * Build Athena query for CUR data
   * Used when athenaDatabase and athenaTable are configured
   */
  buildAthenaQuery(month: string, payerAccountIds?: string[]): string {
    const [year, monthNum] = month.split('-').map(Number);
    const billingPeriod = `${year}-${String(monthNum).padStart(2, '0')}-01`;

    let accountFilter = '';
    if (payerAccountIds && payerAccountIds.length > 0) {
      const accounts = payerAccountIds.map((a) => `'${a}'`).join(', ');
      accountFilter = `AND bill_payer_account_id IN (${accounts})`;
    }

    return `
      SELECT
        identity_line_item_id,
        identity_time_interval,
        bill_invoice_id,
        bill_payer_account_id,
        bill_billing_period_start_date,
        bill_billing_period_end_date,
        line_item_usage_account_id,
        line_item_line_item_type,
        line_item_usage_start_date,
        line_item_usage_end_date,
        line_item_product_code,
        line_item_usage_type,
        line_item_operation,
        line_item_resource_id,
        line_item_usage_amount,
        line_item_currency_code,
        line_item_unblended_cost,
        line_item_blended_cost,
        product_product_name,
        product_region,
        pricing_unit,
        pricing_public_on_demand_cost,
        savings_plan_savings_plan_effective_cost
      FROM "${this.config.athenaDatabase}"."${this.config.athenaTable}"
      WHERE bill_billing_period_start_date = DATE '${billingPeriod}'
        ${accountFilter}
      ORDER BY line_item_usage_start_date
    `;
  }
}

/**
 * Create an AWS CUR adapter from environment variables
 */
export function createAwsCurAdapterFromEnv(): AwsCurAdapter {
  const s3Bucket = process.env.AWS_CUR_S3_BUCKET;
  const s3Prefix = process.env.AWS_CUR_S3_PREFIX || '';
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!s3Bucket) {
    throw new Error(
      'Missing required AWS CUR configuration. Set AWS_CUR_S3_BUCKET environment variable.'
    );
  }

  return new AwsCurAdapter({
    s3Bucket,
    s3Prefix,
    region,
    athenaDatabase: process.env.AWS_CUR_ATHENA_DATABASE,
    athenaTable: process.env.AWS_CUR_ATHENA_TABLE,
    payerAccountIds: process.env.AWS_CUR_PAYER_ACCOUNT_IDS?.split(',').map((s) => s.trim()),
  });
}
