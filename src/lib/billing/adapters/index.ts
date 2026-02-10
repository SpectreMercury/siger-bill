/**
 * Billing Adapters Module (Phase 5)
 *
 * Exports multi-provider billing adapters for unified billing data ingestion.
 */

// Types and interfaces
export {
  type BillingSourceAdapter,
  type BillingLineItemDTO,
  type FetchLineItemsParams,
  type FetchLineItemsResult,
  type GcpBigQueryAdapterConfig,
  type AwsCurAdapterConfig,
  type OpenAiUsageAdapterConfig,
  type AzureCostAdapterConfig,
  PROVIDER_FIELD_MAPPINGS,
  createLineItemsChecksum,
} from './types';

// GCP BigQuery Adapter
export { GcpBigQueryAdapter, createGcpBigQueryAdapterFromEnv } from './gcp-bigquery';

// AWS CUR Adapter
export { AwsCurAdapter, createAwsCurAdapterFromEnv, type AwsCurRow } from './aws-cur';

// OpenAI Usage Adapter
export { OpenAiUsageAdapter, createOpenAiUsageAdapterFromEnv } from './openai-usage';

// Adapter factory
import { BillingProvider } from '@prisma/client';
import { BillingSourceAdapter } from './types';
import { createGcpBigQueryAdapterFromEnv } from './gcp-bigquery';
import { createAwsCurAdapterFromEnv } from './aws-cur';
import { createOpenAiUsageAdapterFromEnv } from './openai-usage';

/**
 * Create a billing adapter for the specified provider using environment configuration
 */
export function createAdapterFromEnv(provider: BillingProvider): BillingSourceAdapter {
  switch (provider) {
    case BillingProvider.GCP:
      return createGcpBigQueryAdapterFromEnv();
    case BillingProvider.AWS:
      return createAwsCurAdapterFromEnv();
    case BillingProvider.OPENAI:
      return createOpenAiUsageAdapterFromEnv();
    case BillingProvider.AZURE:
      throw new Error('Azure adapter not yet implemented');
    case BillingProvider.CUSTOM:
      throw new Error('Custom adapter requires explicit configuration');
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
