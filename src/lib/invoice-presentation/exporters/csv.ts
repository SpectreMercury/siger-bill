/**
 * CSV Exporter (Phase 6)
 *
 * Exports invoice data to CSV format with both raw and aggregated views.
 */

import { InvoicePresentation, PresentationRow, ExportResult, ExportOptions } from '../types';
import { generateContentHash } from '../builder';

/**
 * Format a decimal value for CSV
 */
function formatDecimal(value: { toString: () => string }): string {
  return parseFloat(value.toString()).toFixed(2);
}

/**
 * Format a date for CSV
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Escape a CSV field
 */
function escapeCSV(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  // If the value contains comma, newline, or quotes, wrap in quotes and escape quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build CSV row from array of values
 */
function buildCSVRow(values: (string | number | undefined | null)[]): string {
  return values.map((v) => escapeCSV(v?.toString())).join(',');
}

/**
 * Generate aggregated CSV content
 */
function generateAggregatedCSV(presentation: InvoicePresentation): string {
  const lines: string[] = [];

  // Header section
  lines.push('# INVOICE SUMMARY');
  lines.push(`Invoice Number,${presentation.header.invoiceNumber}`);
  lines.push(`Invoice Date,${formatDate(presentation.header.invoiceDate)}`);
  lines.push(`Due Date,${formatDate(presentation.header.dueDate)}`);
  lines.push(`Billing Month,${presentation.header.billingMonth}`);
  lines.push(`Status,${presentation.header.status}`);
  lines.push('');

  // Customer section
  lines.push('# CUSTOMER');
  lines.push(`Customer Name,${escapeCSV(presentation.customer.name)}`);
  lines.push(`Customer ID,${presentation.customer.externalId || presentation.customer.id}`);
  if (presentation.customer.contactEmail) {
    lines.push(`Contact Email,${presentation.customer.contactEmail}`);
  }
  lines.push('');

  // Line items header
  lines.push('# LINE ITEMS');
  lines.push(buildCSVRow([
    'Row ID',
    'Description',
    'Product Group',
    'Provider',
    'Service',
    'Quantity',
    'Unit',
    'List Amount',
    'Discount',
    'Tier Discount',
    'Credits Applied',
    'Special Rules Adj',
    'Net Amount',
    'Currency',
    'Item Count',
  ]));

  // Line items data
  for (const row of presentation.rows) {
    lines.push(buildCSVRow([
      row.rowId,
      row.description,
      row.productGroup,
      row.provider || '',
      row.service || '',
      formatDecimal(row.usage.quantity),
      row.usage.unit,
      formatDecimal(row.amounts.listAmount),
      formatDecimal(row.amounts.discountAmount),
      formatDecimal(row.amounts.tierDiscountAmount),
      formatDecimal(row.amounts.creditApplied),
      formatDecimal(row.amounts.specialRulesAdjustment),
      formatDecimal(row.amounts.netAmount),
      row.currency,
      row.itemCount.toString(),
    ]));
  }

  lines.push('');

  // Summary section
  lines.push('# TOTALS');
  lines.push(`Subtotal (List),${formatDecimal(presentation.summary.subtotal)},${presentation.summary.currency}`);
  lines.push(`Total Discount,${formatDecimal(presentation.summary.totalDiscount)},${presentation.summary.currency}`);
  lines.push(`Total Tier Discount,${formatDecimal(presentation.summary.totalTierDiscount)},${presentation.summary.currency}`);
  lines.push(`Total Credits,${formatDecimal(presentation.summary.totalCredits)},${presentation.summary.currency}`);
  lines.push(`Tax,${formatDecimal(presentation.summary.taxAmount)},${presentation.summary.currency}`);
  lines.push(`Grand Total,${formatDecimal(presentation.summary.grandTotal)},${presentation.summary.currency}`);

  // Currency breakdown if multi-currency
  if (presentation.summary.currencyBreakdown) {
    lines.push('');
    lines.push('# CURRENCY BREAKDOWN');
    lines.push(buildCSVRow(['Currency', 'Subtotal', 'Net Amount']));
    for (const [currency, amounts] of Object.entries(presentation.summary.currencyBreakdown)) {
      lines.push(buildCSVRow([currency, amounts.subtotal, amounts.netAmount]));
    }
  }

  return lines.join('\n');
}

/**
 * Generate raw line items CSV
 */
function generateRawCSV(presentation: InvoicePresentation): string {
  const lines: string[] = [];

  // Simple header for raw export
  lines.push(buildCSVRow([
    'Invoice Number',
    'Billing Month',
    'Customer',
    'Row ID',
    'Description',
    'Product Group',
    'Quantity',
    'Unit',
    'List Amount',
    'Discount Amount',
    'Net Amount',
    'Currency',
  ]));

  // Data rows
  for (const row of presentation.rows) {
    lines.push(buildCSVRow([
      presentation.header.invoiceNumber,
      presentation.header.billingMonth,
      presentation.customer.name,
      row.rowId,
      row.description,
      row.productGroup,
      formatDecimal(row.usage.quantity),
      row.usage.unit,
      formatDecimal(row.amounts.listAmount),
      formatDecimal(row.amounts.discountAmount),
      formatDecimal(row.amounts.netAmount),
      row.currency,
    ]));
  }

  return lines.join('\n');
}

/**
 * Export invoice to CSV format
 */
export function exportToCSV(
  presentation: InvoicePresentation,
  options: ExportOptions = { format: 'csv' }
): ExportResult {
  // Generate content based on options
  const includeRaw = options.includeRawItems ?? false;
  let content: string;

  if (includeRaw) {
    // Generate both aggregated and raw sections
    content = generateAggregatedCSV(presentation) + '\n\n# RAW LINE ITEMS\n' + generateRawCSV(presentation);
  } else {
    content = generateAggregatedCSV(presentation);
  }

  const buffer = Buffer.from(content, 'utf-8');
  const contentHash = generateContentHash(buffer);

  const filename = `invoice-${presentation.header.invoiceNumber}-${formatDate(new Date())}.csv`;

  return {
    content: buffer,
    mimeType: 'text/csv',
    filename,
    contentHash,
    metadata: {
      format: 'csv',
      rowCount: presentation.rows.length,
      generatedAt: new Date(),
      invoiceNumber: presentation.header.invoiceNumber,
    },
  };
}
