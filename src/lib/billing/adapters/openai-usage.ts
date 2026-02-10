/**
 * OpenAI Usage API Adapter (Phase 5)
 *
 * Fetches usage data from OpenAI's Usage API and normalizes it
 * into unified BillingLineItem format.
 *
 * OpenAI Usage API: https://platform.openai.com/docs/api-reference/usage
 */

import { BillingProvider, BillingSourceType, Prisma } from '@prisma/client';
import {
  BillingSourceAdapter,
  BillingLineItemDTO,
  FetchLineItemsParams,
  FetchLineItemsResult,
  OpenAiUsageAdapterConfig,
  createLineItemsChecksum,
} from './types';

/**
 * OpenAI usage bucket from the API
 */
interface OpenAiUsageBucket {
  object: 'bucket';
  start_time: number; // Unix timestamp
  end_time: number; // Unix timestamp
  results: OpenAiUsageResult[];
}

/**
 * OpenAI usage result within a bucket
 */
interface OpenAiUsageResult {
  object: 'organization_usage';
  input_tokens: number;
  output_tokens: number;
  num_model_requests: number;
  project_id: string | null;
  user_id: string | null;
  api_key_id: string | null;
  model: string;
  batch: boolean;
  input_cached_tokens?: number;
  input_audio_tokens?: number;
  output_audio_tokens?: number;
}

/**
 * OpenAI API response for usage endpoint
 */
interface OpenAiUsageResponse {
  object: 'page';
  data: OpenAiUsageBucket[];
  has_more: boolean;
  next_page: string | null;
}

/**
 * OpenAI model pricing (per 1M tokens) - as of 2024
 * Note: These should be fetched from a configuration or pricing API
 */
const OPENAI_PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00, cachedInput: 1.25 },
  'gpt-4o-2024-11-20': { input: 2.50, output: 10.00, cachedInput: 1.25 },
  'gpt-4o-2024-08-06': { input: 2.50, output: 10.00, cachedInput: 1.25 },
  'gpt-4o-2024-05-13': { input: 5.00, output: 15.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cachedInput: 0.075 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60, cachedInput: 0.075 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4-turbo-2024-04-09': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-4-32k': { input: 60.00, output: 120.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'gpt-3.5-turbo-0125': { input: 0.50, output: 1.50 },
  'gpt-3.5-turbo-instruct': { input: 1.50, output: 2.00 },
  'o1': { input: 15.00, output: 60.00, cachedInput: 7.50 },
  'o1-2024-12-17': { input: 15.00, output: 60.00, cachedInput: 7.50 },
  'o1-preview': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00, cachedInput: 1.50 },
  'o3-mini': { input: 1.10, output: 4.40, cachedInput: 0.55 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'text-embedding-ada-002': { input: 0.10, output: 0 },
  'dall-e-3': { input: 0, output: 0 }, // Image pricing is per image, handled separately
  'dall-e-2': { input: 0, output: 0 },
  'whisper-1': { input: 0.006, output: 0 }, // Per minute
  'tts-1': { input: 15.00, output: 0 }, // Per 1M characters
  'tts-1-hd': { input: 30.00, output: 0 },
};

export class OpenAiUsageAdapter implements BillingSourceAdapter {
  readonly provider = BillingProvider.OPENAI;
  readonly sourceType = BillingSourceType.USAGE_API;

  private config: OpenAiUsageAdapterConfig;

  constructor(config: OpenAiUsageAdapterConfig) {
    this.config = config;
  }

  async fetchLineItems(params: FetchLineItemsParams): Promise<FetchLineItemsResult> {
    const { month } = params;

    // Calculate date range for the month
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
    const endDate = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999));

    // Fetch usage data from OpenAI API
    const usageBuckets = await this.fetchUsageData(startDate, endDate);

    // Normalize to BillingLineItemDTO
    const lineItems = this.normalizeUsageData(usageBuckets, month);

    // Calculate checksum
    const checksum = createLineItemsChecksum(lineItems);

    return {
      lineItems,
      rowCount: lineItems.length,
      checksum,
      sourceMetadata: {
        source: 'https://api.openai.com/v1/organization/usage',
        dataRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        organizationId: this.config.organizationId,
        projectId: this.config.projectId,
        bucketsProcessed: usageBuckets.length,
      },
    };
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/organization/usage', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'OpenAI-Organization': this.config.organizationId,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('OpenAI connection validation failed:', error);
      return false;
    }
  }

  async listAccounts(): Promise<Array<{ id: string; name: string }>> {
    // OpenAI doesn't have the same concept of accounts
    // Return organization and projects
    return [
      { id: this.config.organizationId, name: 'Organization' },
    ];
  }

  /**
   * Fetch usage data from OpenAI API
   */
  private async fetchUsageData(startDate: Date, endDate: Date): Promise<OpenAiUsageBucket[]> {
    const buckets: OpenAiUsageBucket[] = [];
    let nextPage: string | null = null;

    const startTime = Math.floor(startDate.getTime() / 1000);
    const endTime = Math.floor(endDate.getTime() / 1000);

    do {
      const url = new URL('https://api.openai.com/v1/organization/usage');
      url.searchParams.set('start_time', startTime.toString());
      url.searchParams.set('end_time', endTime.toString());
      url.searchParams.set('bucket_width', '1d'); // Daily buckets
      url.searchParams.set('group_by', 'project_id,model');

      if (this.config.projectId) {
        url.searchParams.set('project_ids', this.config.projectId);
      }

      if (nextPage) {
        url.searchParams.set('page', nextPage);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'OpenAI-Organization': this.config.organizationId,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data: OpenAiUsageResponse = await response.json();
      buckets.push(...data.data);
      nextPage = data.has_more ? data.next_page : null;
    } while (nextPage);

    return buckets;
  }

  /**
   * Normalize OpenAI usage data to unified BillingLineItemDTO
   */
  private normalizeUsageData(buckets: OpenAiUsageBucket[], month: string): BillingLineItemDTO[] {
    const lineItems: BillingLineItemDTO[] = [];

    for (const bucket of buckets) {
      const usageStartTime = new Date(bucket.start_time * 1000);
      const usageEndTime = new Date(bucket.end_time * 1000);

      for (const result of bucket.results) {
        const pricing = OPENAI_PRICING[result.model] || { input: 0, output: 0 };

        // Calculate input tokens (regular + cached)
        const regularInputTokens = result.input_tokens - (result.input_cached_tokens || 0);
        const cachedInputTokens = result.input_cached_tokens || 0;

        // Calculate costs
        const inputCost = (regularInputTokens / 1_000_000) * pricing.input;
        const cachedInputCost = (cachedInputTokens / 1_000_000) * (pricing.cachedInput || pricing.input);
        const outputCost = (result.output_tokens / 1_000_000) * pricing.output;
        const totalCost = inputCost + cachedInputCost + outputCost;

        // Create line item for input tokens
        if (result.input_tokens > 0) {
          lineItems.push({
            provider: BillingProvider.OPENAI,
            sourceType: BillingSourceType.USAGE_API,
            accountId: this.config.organizationId,
            subaccountId: result.project_id || undefined,
            productId: result.model,
            meterId: 'input_tokens',
            usageAmount: new Prisma.Decimal(result.input_tokens),
            usageUnit: 'tokens',
            cost: new Prisma.Decimal(inputCost + cachedInputCost),
            listCost: new Prisma.Decimal(inputCost + cachedInputCost),
            currency: 'USD',
            usageStartTime,
            usageEndTime,
            invoiceMonth: month,
            tags: result.batch ? { batch: 'true' } : undefined,
            rawPayload: {
              ...result,
              bucket_start_time: bucket.start_time,
              bucket_end_time: bucket.end_time,
              token_type: 'input',
              pricing_per_million: pricing.input,
              cached_tokens: cachedInputTokens,
            },
          });
        }

        // Create line item for output tokens
        if (result.output_tokens > 0) {
          lineItems.push({
            provider: BillingProvider.OPENAI,
            sourceType: BillingSourceType.USAGE_API,
            accountId: this.config.organizationId,
            subaccountId: result.project_id || undefined,
            productId: result.model,
            meterId: 'output_tokens',
            usageAmount: new Prisma.Decimal(result.output_tokens),
            usageUnit: 'tokens',
            cost: new Prisma.Decimal(outputCost),
            listCost: new Prisma.Decimal(outputCost),
            currency: 'USD',
            usageStartTime,
            usageEndTime,
            invoiceMonth: month,
            tags: result.batch ? { batch: 'true' } : undefined,
            rawPayload: {
              ...result,
              bucket_start_time: bucket.start_time,
              bucket_end_time: bucket.end_time,
              token_type: 'output',
              pricing_per_million: pricing.output,
            },
          });
        }

        // Create line item for API requests (for tracking purposes)
        if (result.num_model_requests > 0) {
          lineItems.push({
            provider: BillingProvider.OPENAI,
            sourceType: BillingSourceType.USAGE_API,
            accountId: this.config.organizationId,
            subaccountId: result.project_id || undefined,
            productId: result.model,
            meterId: 'api_requests',
            usageAmount: new Prisma.Decimal(result.num_model_requests),
            usageUnit: 'requests',
            cost: new Prisma.Decimal(0), // Requests are not separately billed
            currency: 'USD',
            usageStartTime,
            usageEndTime,
            invoiceMonth: month,
            tags: result.batch ? { batch: 'true' } : undefined,
            rawPayload: {
              ...result,
              bucket_start_time: bucket.start_time,
              bucket_end_time: bucket.end_time,
              metric_type: 'requests',
            },
          });
        }
      }
    }

    return lineItems;
  }
}

/**
 * Create an OpenAI usage adapter from environment variables
 */
export function createOpenAiUsageAdapterFromEnv(): OpenAiUsageAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  const organizationId = process.env.OPENAI_ORGANIZATION_ID;

  if (!apiKey || !organizationId) {
    throw new Error(
      'Missing required OpenAI configuration. Set OPENAI_API_KEY and OPENAI_ORGANIZATION_ID environment variables.'
    );
  }

  return new OpenAiUsageAdapter({
    apiKey,
    organizationId,
    projectId: process.env.OPENAI_PROJECT_ID,
  });
}
