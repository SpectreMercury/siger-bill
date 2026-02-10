/**
 * Billing Source Adapter Types (Phase 5)
 *
 * Defines the interface and types for multi-provider billing data ingestion.
 * Adapters normalize vendor-specific data into unified BillingLineItem format.
 */

import { BillingProvider, BillingSourceType, Prisma } from '@prisma/client';

/**
 * Unified billing line item - provider-agnostic cost data
 * This matches the Prisma model but is used as a DTO for adapters
 */
export interface BillingLineItemDTO {
  // Provider identification
  provider: BillingProvider;
  sourceType: BillingSourceType;

  // Account hierarchy (normalized across providers)
  accountId: string; // GCP: billing_account_id, AWS: payer_account_id, OpenAI: organization_id
  subaccountId?: string; // GCP: project_id, AWS: usage_account_id, OpenAI: project_id
  resourceId?: string; // GCP: resource.name, AWS: resource_id, OpenAI: null

  // Product/service identification
  productId: string; // GCP: service.id, AWS: product_code, OpenAI: model
  meterId: string; // GCP: sku.id, AWS: usage_type, OpenAI: operation (tokens/images)

  // Usage metrics
  usageAmount: Prisma.Decimal;
  usageUnit: string; // GCP: usage.unit, AWS: usage_amount unit, OpenAI: tokens/images

  // Cost data
  cost: Prisma.Decimal; // Actual cost after discounts
  listCost?: Prisma.Decimal; // List/public price before discounts
  currency: string;

  // Time range
  usageStartTime: Date;
  usageEndTime: Date;
  invoiceMonth: string; // YYYY-MM format

  // Optional metadata
  region?: string;
  tags?: Record<string, string>;

  // Raw payload for audit trail
  rawPayload?: unknown;
}

/**
 * Parameters for fetching billing line items
 */
export interface FetchLineItemsParams {
  /** Billing provider to fetch from */
  provider: BillingProvider;

  /** Invoice month in YYYY-MM format */
  month: string;

  /** Optional: Filter by specific account IDs (billing accounts for GCP, payer accounts for AWS) */
  accountIds?: string[];

  /** Optional: Filter by customer ID (for customer-scoped queries) */
  customerId?: string;

  /** Optional: Additional provider-specific options */
  options?: Record<string, unknown>;
}

/**
 * Result of fetching line items from a provider
 */
export interface FetchLineItemsResult {
  /** Fetched and normalized line items */
  lineItems: BillingLineItemDTO[];

  /** Number of rows fetched */
  rowCount: number;

  /** Checksum for deduplication */
  checksum: string;

  /** Provider-specific metadata for audit trail */
  sourceMetadata: {
    /** Query or API call details */
    query?: string;
    /** Table/endpoint accessed */
    source?: string;
    /** Time range of data */
    dataRange?: {
      start: string;
      end: string;
    };
    /** Any warnings or notes */
    warnings?: string[];
    /** Provider-specific fields */
    [key: string]: unknown;
  };
}

/**
 * Billing source adapter interface
 *
 * Adapters are responsible for:
 * 1. Fetching raw billing data from the source
 * 2. Normalizing vendor-specific fields into BillingLineItemDTO
 * 3. NOT applying pricing or credits (that's the engine's job)
 * 4. Attaching raw_payload for audit trail
 */
export interface BillingSourceAdapter {
  /** Provider this adapter handles */
  readonly provider: BillingProvider;

  /** Source type this adapter uses */
  readonly sourceType: BillingSourceType;

  /**
   * Fetch billing line items from the source
   *
   * @param params Fetch parameters
   * @returns Normalized billing line items with metadata
   */
  fetchLineItems(params: FetchLineItemsParams): Promise<FetchLineItemsResult>;

  /**
   * Validate connection to the billing source
   *
   * @returns true if connection is valid
   */
  validateConnection(): Promise<boolean>;

  /**
   * Get available accounts/subscriptions from the source
   *
   * @returns List of account identifiers
   */
  listAccounts(): Promise<Array<{ id: string; name: string }>>;
}

/**
 * Configuration for GCP BigQuery adapter
 */
export interface GcpBigQueryAdapterConfig {
  /** BigQuery project ID */
  projectId: string;

  /** BigQuery dataset containing billing export */
  datasetId: string;

  /** BigQuery table name (usually 'gcp_billing_export_v1_*') */
  tableName: string;

  /** Optional: Service account key path */
  keyFilePath?: string;

  /** Optional: Filter by billing account IDs */
  billingAccountIds?: string[];
}

/**
 * Configuration for AWS CUR adapter
 */
export interface AwsCurAdapterConfig {
  /** S3 bucket containing CUR files */
  s3Bucket: string;

  /** S3 prefix for CUR files */
  s3Prefix: string;

  /** AWS region */
  region: string;

  /** Optional: Athena database for querying */
  athenaDatabase?: string;

  /** Optional: Athena table name */
  athenaTable?: string;

  /** Optional: Filter by payer account IDs */
  payerAccountIds?: string[];
}

/**
 * Configuration for OpenAI Usage adapter
 */
export interface OpenAiUsageAdapterConfig {
  /** OpenAI API key */
  apiKey: string;

  /** Organization ID */
  organizationId: string;

  /** Optional: Project ID filter */
  projectId?: string;
}

/**
 * Configuration for Azure Cost Management adapter
 */
export interface AzureCostAdapterConfig {
  /** Azure subscription ID */
  subscriptionId: string;

  /** Tenant ID */
  tenantId: string;

  /** Client ID for service principal */
  clientId: string;

  /** Client secret */
  clientSecret: string;

  /** Optional: Resource group filter */
  resourceGroup?: string;
}

/**
 * Provider-specific field mappings for normalization reference
 *
 * GCP BigQuery Export:
 * - accountId: billing_account_id
 * - subaccountId: project.id
 * - resourceId: resource.name
 * - productId: service.id
 * - meterId: sku.id
 * - usageAmount: usage.amount
 * - usageUnit: usage.unit
 * - cost: cost
 * - listCost: (calculated from pricing)
 * - currency: currency
 * - region: location.region
 * - tags: labels
 *
 * AWS CUR:
 * - accountId: bill_payer_account_id
 * - subaccountId: line_item_usage_account_id
 * - resourceId: line_item_resource_id
 * - productId: product_product_name or line_item_product_code
 * - meterId: line_item_usage_type
 * - usageAmount: line_item_usage_amount
 * - usageUnit: pricing_unit
 * - cost: line_item_unblended_cost
 * - listCost: line_item_blended_cost (or pricing_public_on_demand_cost)
 * - currency: line_item_currency_code
 * - region: product_region
 * - tags: resource_tags_*
 *
 * OpenAI Usage API:
 * - accountId: organization_id
 * - subaccountId: project_id
 * - resourceId: null
 * - productId: model (gpt-4, gpt-3.5-turbo, etc.)
 * - meterId: operation (input_tokens, output_tokens, images)
 * - usageAmount: n_context_tokens_total, n_generated_tokens_total
 * - usageUnit: tokens, images
 * - cost: (calculated from usage * rate)
 * - listCost: same as cost (no discounts)
 * - currency: USD
 * - region: null
 * - tags: null
 */
export const PROVIDER_FIELD_MAPPINGS = {
  GCP: {
    accountId: 'billing_account_id',
    subaccountId: 'project.id',
    resourceId: 'resource.name',
    productId: 'service.id',
    meterId: 'sku.id',
    usageAmount: 'usage.amount',
    usageUnit: 'usage.unit',
    cost: 'cost',
    currency: 'currency',
    region: 'location.region',
    tags: 'labels',
  },
  AWS: {
    accountId: 'bill_payer_account_id',
    subaccountId: 'line_item_usage_account_id',
    resourceId: 'line_item_resource_id',
    productId: 'line_item_product_code',
    meterId: 'line_item_usage_type',
    usageAmount: 'line_item_usage_amount',
    usageUnit: 'pricing_unit',
    cost: 'line_item_unblended_cost',
    listCost: 'pricing_public_on_demand_cost',
    currency: 'line_item_currency_code',
    region: 'product_region',
    tags: 'resource_tags',
  },
  OPENAI: {
    accountId: 'organization_id',
    subaccountId: 'project_id',
    productId: 'model',
    meterId: 'operation',
    usageAmount: 'tokens',
    usageUnit: 'tokens',
    cost: 'cost',
    currency: 'USD',
  },
} as const;

/**
 * Create a checksum from line items for deduplication
 */
export function createLineItemsChecksum(lineItems: BillingLineItemDTO[]): string {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');

  // Sort and hash key fields for deterministic checksum
  const sortedItems = [...lineItems].sort((a, b) => {
    const keyA = `${a.accountId}-${a.productId}-${a.meterId}-${a.usageStartTime.toISOString()}`;
    const keyB = `${b.accountId}-${b.productId}-${b.meterId}-${b.usageStartTime.toISOString()}`;
    return keyA.localeCompare(keyB);
  });

  for (const item of sortedItems) {
    hash.update(
      `${item.accountId}|${item.subaccountId || ''}|${item.productId}|${item.meterId}|` +
        `${item.usageAmount.toString()}|${item.cost.toString()}|${item.usageStartTime.toISOString()}`
    );
  }

  return hash.digest('hex');
}
