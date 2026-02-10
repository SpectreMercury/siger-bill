/**
 * Invoice Presentation Types (Phase 6)
 *
 * Types for transforming engine outputs into human-readable,
 * finance-grade invoice presentations.
 */

import { Prisma } from '@prisma/client';

/**
 * Aggregation level for invoice rows
 */
export type AggregationLevel = 'product_group' | 'provider' | 'service' | 'sku';

/**
 * A single aggregated invoice row for presentation
 */
export interface PresentationRow {
  /** Row identifier */
  rowId: string;

  /** Grouping information */
  groupKey: string;
  groupType: AggregationLevel;

  /** Description for the line item */
  description: string;

  /** Product/service group name */
  productGroup: string;

  /** Provider (GCP, AWS, OPENAI, etc.) */
  provider?: string;

  /** Service name (e.g., Compute Engine, S3, etc.) */
  service?: string;

  /** Usage summary */
  usage: {
    /** Total usage amount */
    quantity: Prisma.Decimal;
    /** Unit of measurement */
    unit: string;
    /** Usage period */
    period: {
      start: Date;
      end: Date;
    };
  };

  /** Amounts breakdown */
  amounts: {
    /** List/gross amount before any discounts */
    listAmount: Prisma.Decimal;

    /** Discount from pricing rules (percentage-based) */
    discountAmount: Prisma.Decimal;

    /** Discount from tier pricing */
    tierDiscountAmount: Prisma.Decimal;

    /** Credits applied to this row */
    creditApplied: Prisma.Decimal;

    /** Special rules adjustment (exclude/override) */
    specialRulesAdjustment: Prisma.Decimal;

    /** Net amount after all adjustments */
    netAmount: Prisma.Decimal;
  };

  /** Currency */
  currency: string;

  /** Number of underlying line items */
  itemCount: number;

  /** Metadata for drill-down */
  metadata?: {
    skuIds?: string[];
    pricingRuleId?: string;
    discountRate?: string;
    tierInfo?: string;
  };
}

/**
 * Invoice summary totals
 */
export interface InvoiceSummary {
  /** Subtotal (list amount before discounts) */
  subtotal: Prisma.Decimal;

  /** Total discount amount */
  totalDiscount: Prisma.Decimal;

  /** Total tier discount */
  totalTierDiscount: Prisma.Decimal;

  /** Total credits applied */
  totalCredits: Prisma.Decimal;

  /** Total special rules adjustment */
  totalSpecialRulesAdjustment: Prisma.Decimal;

  /** Tax amount */
  taxAmount: Prisma.Decimal;

  /** Grand total */
  grandTotal: Prisma.Decimal;

  /** Currency */
  currency: string;

  /** Currency breakdown if multi-currency */
  currencyBreakdown?: Record<string, {
    subtotal: string;
    netAmount: string;
  }>;
}

/**
 * Complete invoice presentation
 */
export interface InvoicePresentation {
  /** Invoice header information */
  header: {
    invoiceNumber: string;
    invoiceDate: Date;
    dueDate: Date;
    billingMonth: string;
    status: string;
  };

  /** Customer information */
  customer: {
    id: string;
    name: string;
    externalId?: string;
    address?: string;
    contactEmail?: string;
    taxId?: string;
  };

  /** Billing entity (your company) */
  billingEntity: {
    name: string;
    address: string;
    taxId?: string;
    bankDetails?: string;
  };

  /** Aggregated line items */
  rows: PresentationRow[];

  /** Summary totals */
  summary: InvoiceSummary;

  /** Payment terms */
  paymentTerms: {
    days: number;
    instructions?: string;
  };

  /** Notes and terms */
  notes?: string;
  terms?: string;

  /** Audit information */
  audit: {
    invoiceRunId: string;
    generatedAt: Date;
    configSnapshotId?: string;
  };
}

/**
 * Export format options
 */
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/**
 * Export options
 */
export interface ExportOptions {
  /** Export format */
  format: ExportFormat;

  /** Aggregation level for CSV/XLSX */
  aggregationLevel?: AggregationLevel;

  /** Include raw line items (for XLSX) */
  includeRawItems?: boolean;

  /** Include credits breakdown (for XLSX) */
  includeCreditsBreakdown?: boolean;

  /** Locale for formatting */
  locale?: string;

  /** Timezone for date formatting */
  timezone?: string;
}

/**
 * Export result
 */
export interface ExportResult {
  /** File content (buffer) */
  content: Buffer;

  /** MIME type */
  mimeType: string;

  /** Suggested filename */
  filename: string;

  /** Content hash for audit */
  contentHash: string;

  /** Export metadata */
  metadata: {
    format: ExportFormat;
    rowCount: number;
    generatedAt: Date;
    invoiceNumber: string;
  };
}

/**
 * Credit breakdown for presentation
 */
export interface CreditBreakdown {
  creditId: string;
  creditType: string;
  description: string;
  originalAmount: Prisma.Decimal;
  appliedAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  expiresAt?: Date;
}

/**
 * Pricing breakdown for presentation
 */
export interface PricingBreakdown {
  pricingListId: string;
  pricingListName: string;
  rules: Array<{
    ruleId: string;
    skuGroupCode: string;
    discountType: string;
    discountRate: string;
    rawAmount: string;
    discountAmount: string;
    finalAmount: string;
  }>;
}
