/**
 * Request Validation Utilities
 *
 * Provides Zod schemas and validation helpers for API requests.
 */

import { z } from 'zod';

/**
 * Common validation patterns
 */
export const patterns = {
  uuid: z.string().uuid(),
  email: z.string().email(),
  billingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Must be YYYY-MM format'),
  currency: z.string().length(3).toUpperCase(),
};

/**
 * Login request schema
 */
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Customer creation schema
 */
export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  externalId: z.string().max(100).optional(),
  billingAccountId: z.string().max(100).optional(),
  domain: z.string().max(255).optional(),
  currency: patterns.currency.default('USD'),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  primaryContactName: z.string().max(255).optional(),
  primaryContactEmail: z.string().email().optional(),
});

/**
 * Customer update schema
 */
export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  externalId: z.string().max(100).optional().nullable(),
  billingAccountId: z.string().max(100).optional().nullable(),
  domain: z.string().max(255).optional().nullable(),
  currency: patterns.currency.optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  primaryContactName: z.string().max(255).optional().nullable(),
  primaryContactEmail: z.string().email().optional().nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']).optional(),
});

/**
 * Invoice run creation schema (Phase 2.6)
 *
 * Optional fields for targeted runs:
 * - targetCustomerId: Run billing for specific customer only
 * - ingestionBatchId: Use specific batch for cost data (determines sourceKey)
 */
export const createInvoiceRunSchema = z.object({
  billingMonth: patterns.billingMonth,
  targetCustomerId: z.string().uuid().optional(),
  ingestionBatchId: z.string().uuid().optional(),
});

/**
 * Pagination parameters
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Validate request body with a Zod schema
 */
export async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: z.ZodError }> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
  } catch {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: 'Invalid JSON body',
        },
      ]),
    };
  }
}

/**
 * Format Zod errors for API response
 */
export function formatZodErrors(error: z.ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }

  return formatted;
}

// ============================================================================
// Phase 2 Schemas
// ============================================================================

/**
 * Billing account creation schema
 */
export const createBillingAccountSchema = z.object({
  billingAccountId: z.string().min(1, 'Billing account ID is required').max(100),
  name: z.string().max(255).optional(),
});

/**
 * Project creation schema
 */
export const createProjectSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required').max(100),
  name: z.string().max(255).optional(),
  billingAccountId: z.string().max(100).optional(),
});

/**
 * Customer-project binding schema
 */
export const bindProjectSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required').max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
});

/**
 * Raw cost entry schema (single entry in a bulk import)
 */
export const rawCostEntrySchema = z.object({
  billingAccountId: z.string().max(100),
  projectId: z.string().max(100),
  serviceId: z.string().max(100),
  skuId: z.string().max(100),
  usageStartTime: z.string().datetime(),
  usageEndTime: z.string().datetime(),
  usageAmount: z.number(),
  cost: z.number(),
  currency: patterns.currency,
  region: z.string().max(50).optional(),
});

/**
 * Raw cost bulk import schema
 */
export const rawCostImportSchema = z.object({
  source: z.string().max(50).default('manual'),
  month: patterns.billingMonth.optional(),
  entries: z.array(rawCostEntrySchema).min(1, 'At least one entry is required'),
});

/**
 * Raw cost query parameters
 */
export const rawCostQuerySchema = z.object({
  month: patterns.billingMonth.optional(),
  projectId: z.string().optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

// ============================================================================
// Phase 3: SKU & Pricing Schemas
// ============================================================================

/**
 * SKU creation schema
 */
export const createSkuSchema = z.object({
  skuId: z.string().min(1, 'SKU ID is required').max(100),
  skuDescription: z.string().min(1, 'SKU description is required').max(500),
  serviceId: z.string().min(1, 'Service ID is required').max(100),
  serviceDescription: z.string().min(1, 'Service description is required').max(255),
  unit: z.string().max(50).optional(),
});

/**
 * Bulk SKU creation schema
 */
export const createSkuBulkSchema = z.object({
  skus: z.array(createSkuSchema).min(1, 'At least one SKU is required'),
});

/**
 * SKU Group creation schema
 */
export const createSkuGroupSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50).regex(/^[A-Za-z0-9-_]+$/, 'Code must be alphanumeric with dashes/underscores'),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
});

/**
 * SKU Group mapping schema (bind SKUs to group)
 */
export const skuGroupMappingSchema = z.object({
  skuIds: z.array(z.string().min(1)).min(1, 'At least one SKU ID is required'), // Google SKU IDs
});

/**
 * Pricing list creation schema
 */
export const createPricingListSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

/**
 * Pricing rule creation schema
 */
export const createPricingRuleSchema = z.object({
  ruleType: z.enum(['LIST_DISCOUNT']).default('LIST_DISCOUNT'),
  discountRate: z.number().min(0).max(2), // 0.90 = 90% of list (10% discount), can go > 1 for markup
  skuGroupId: z.string().uuid().optional().nullable(), // null = applies to all
  effectiveStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional().nullable(),
  effectiveEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional().nullable(),
  priority: z.number().int().min(0).max(9999).default(100),
});

// ============================================================================
// Phase 3.3: Credit Schemas
// ============================================================================

/**
 * Credit creation schema
 */
export const createCreditSchema = z.object({
  type: z.enum(['PROMOTION', 'CONTRACT', 'FLEX']),
  totalAmount: z.number().positive('Total amount must be positive'),
  currency: patterns.currency.default('USD'),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  allowCarryOver: z.boolean().default(false),
  billingAccountId: z.string().max(100).optional().nullable(),
  sourceReference: z.string().max(255).optional().nullable(),
  description: z.string().optional().nullable(),
});

/**
 * Credit update schema
 */
export const updateCreditSchema = z.object({
  status: z.enum(['ACTIVE', 'EXPIRED', 'DEPLETED']).optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
  allowCarryOver: z.boolean().optional(),
  description: z.string().optional().nullable(),
});

// ============================================================================
// Phase 3.5: Special Rules Schemas
// ============================================================================

/**
 * Special rule creation schema
 */
export const createSpecialRuleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(9999).default(100),
  ruleType: z.enum(['EXCLUDE_SKU', 'EXCLUDE_SKU_GROUP', 'OVERRIDE_COST', 'MOVE_TO_CUSTOMER']),
  // Match conditions
  matchSkuId: z.string().max(100).optional().nullable(),
  matchSkuGroupId: z.string().uuid().optional().nullable(),
  matchServiceId: z.string().max(100).optional().nullable(),
  matchProjectId: z.string().max(100).optional().nullable(),
  matchBillingAccountId: z.string().max(100).optional().nullable(),
  // Rule parameters
  costMultiplier: z.number().min(0).max(10).optional().nullable(), // 0 = free, max 10x markup
  targetCustomerId: z.string().uuid().optional().nullable(),
  // Validity period
  effectiveStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional().nullable(),
  effectiveEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional().nullable(),
});

/**
 * Special rule update schema
 */
export const updateSpecialRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  // Match conditions
  matchSkuId: z.string().max(100).optional().nullable(),
  matchSkuGroupId: z.string().uuid().optional().nullable(),
  matchServiceId: z.string().max(100).optional().nullable(),
  matchProjectId: z.string().max(100).optional().nullable(),
  matchBillingAccountId: z.string().max(100).optional().nullable(),
  // Rule parameters
  costMultiplier: z.number().min(0).max(10).optional().nullable(),
  targetCustomerId: z.string().uuid().optional().nullable(),
  // Validity period
  effectiveStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional().nullable(),
  effectiveEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional().nullable(),
});
