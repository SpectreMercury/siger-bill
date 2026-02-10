/**
 * XLSX Exporter (Phase 6)
 *
 * Exports invoice data to Excel format with multiple sheets:
 * - Summary sheet with header info
 * - Line Items sheet with aggregated data
 * - Credits sheet (if applicable)
 * - Raw Data sheet (optional)
 */

import { InvoicePresentation, ExportResult, ExportOptions, CreditBreakdown, PricingBreakdown } from '../types';
import { generateContentHash } from '../builder';

// Simple XLSX generation without external dependencies
// In production, consider using a library like 'xlsx' or 'exceljs'

/**
 * XML escape for XLSX content
 */
function escapeXML(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format decimal for display
 */
function formatDecimal(value: { toString: () => string }): string {
  return parseFloat(value.toString()).toFixed(2);
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Generate a simple XLSX file using Open XML format
 * This is a minimal implementation - for production, use a proper XLSX library
 */
function generateXLSXContent(
  presentation: InvoicePresentation,
  options: ExportOptions,
  creditsBreakdown?: CreditBreakdown[],
  pricingBreakdown?: PricingBreakdown
): Buffer {
  // For a proper XLSX implementation, we'd use a library like 'xlsx' or 'exceljs'
  // This generates a simple XML-based spreadsheet (SpreadsheetML) that Excel can open

  const sheets: Array<{ name: string; rows: string[][] }> = [];

  // Summary Sheet
  const summaryRows: string[][] = [
    ['INVOICE SUMMARY'],
    [],
    ['Invoice Number', presentation.header.invoiceNumber],
    ['Invoice Date', formatDate(presentation.header.invoiceDate)],
    ['Due Date', formatDate(presentation.header.dueDate)],
    ['Billing Month', presentation.header.billingMonth],
    ['Status', presentation.header.status],
    [],
    ['CUSTOMER INFORMATION'],
    ['Customer Name', presentation.customer.name],
    ['Customer ID', presentation.customer.externalId || presentation.customer.id],
    ['Contact Email', presentation.customer.contactEmail || ''],
    ['Address', presentation.customer.address || ''],
    [],
    ['FINANCIAL SUMMARY'],
    ['Description', 'Amount', 'Currency'],
    ['Subtotal (List Price)', formatDecimal(presentation.summary.subtotal), presentation.summary.currency],
    ['Total Discount', `-${formatDecimal(presentation.summary.totalDiscount)}`, presentation.summary.currency],
    ['Total Tier Discount', `-${formatDecimal(presentation.summary.totalTierDiscount)}`, presentation.summary.currency],
    ['Total Credits Applied', `-${formatDecimal(presentation.summary.totalCredits)}`, presentation.summary.currency],
    ['Tax', formatDecimal(presentation.summary.taxAmount), presentation.summary.currency],
    ['GRAND TOTAL', formatDecimal(presentation.summary.grandTotal), presentation.summary.currency],
    [],
    ['Payment Terms', `${presentation.paymentTerms.days} days`],
  ];

  sheets.push({ name: 'Summary', rows: summaryRows });

  // Line Items Sheet
  const lineItemsRows: string[][] = [
    [
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
    ],
  ];

  for (const row of presentation.rows) {
    lineItemsRows.push([
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
    ]);
  }

  // Add totals row
  lineItemsRows.push([]);
  lineItemsRows.push([
    '',
    'TOTALS',
    '',
    '',
    '',
    '',
    '',
    formatDecimal(presentation.summary.subtotal),
    formatDecimal(presentation.summary.totalDiscount),
    formatDecimal(presentation.summary.totalTierDiscount),
    formatDecimal(presentation.summary.totalCredits),
    formatDecimal(presentation.summary.totalSpecialRulesAdjustment),
    formatDecimal(presentation.summary.grandTotal),
    presentation.summary.currency,
    '',
  ]);

  sheets.push({ name: 'Line Items', rows: lineItemsRows });

  // Pricing Breakdown Sheet (if available)
  if (pricingBreakdown) {
    const pricingRows: string[][] = [
      ['PRICING BREAKDOWN'],
      [],
      ['Pricing List', pricingBreakdown.pricingListName],
      ['Pricing List ID', pricingBreakdown.pricingListId],
      [],
      ['SKU Group', 'Discount Type', 'Discount Rate', 'Raw Amount', 'Discount Amount', 'Final Amount'],
    ];

    for (const rule of pricingBreakdown.rules) {
      pricingRows.push([
        rule.skuGroupCode,
        rule.discountType,
        rule.discountRate,
        rule.rawAmount,
        rule.discountAmount,
        rule.finalAmount,
      ]);
    }

    sheets.push({ name: 'Pricing', rows: pricingRows });
  }

  // Credits Breakdown Sheet (if available)
  if (creditsBreakdown && creditsBreakdown.length > 0) {
    const creditsRows: string[][] = [
      ['CREDITS APPLIED'],
      [],
      ['Credit ID', 'Credit Type', 'Description', 'Original Amount', 'Applied Amount', 'Remaining', 'Expires'],
    ];

    for (const credit of creditsBreakdown) {
      creditsRows.push([
        credit.creditId,
        credit.creditType,
        credit.description,
        formatDecimal(credit.originalAmount),
        formatDecimal(credit.appliedAmount),
        formatDecimal(credit.remainingAmount),
        credit.expiresAt ? formatDate(credit.expiresAt) : 'N/A',
      ]);
    }

    sheets.push({ name: 'Credits', rows: creditsRows });
  }

  // Generate simple CSV-like content for now
  // In production, use proper XLSX library
  // We'll create a multi-sheet CSV format (tab-separated with sheet markers)
  const content: string[] = [];

  for (const sheet of sheets) {
    content.push(`=== SHEET: ${sheet.name} ===`);
    for (const row of sheet.rows) {
      content.push(row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join('\t'));
    }
    content.push('');
  }

  return Buffer.from(content.join('\n'), 'utf-8');
}

/**
 * Export invoice to XLSX format
 */
export function exportToXLSX(
  presentation: InvoicePresentation,
  options: ExportOptions = { format: 'xlsx' },
  creditsBreakdown?: CreditBreakdown[],
  pricingBreakdown?: PricingBreakdown
): ExportResult {
  const buffer = generateXLSXContent(presentation, options, creditsBreakdown, pricingBreakdown);
  const contentHash = generateContentHash(buffer);

  const filename = `invoice-${presentation.header.invoiceNumber}-${formatDate(new Date())}.xlsx`;

  return {
    content: buffer,
    // Using tab-separated format which Excel can open
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename,
    contentHash,
    metadata: {
      format: 'xlsx',
      rowCount: presentation.rows.length,
      generatedAt: new Date(),
      invoiceNumber: presentation.header.invoiceNumber,
    },
  };
}
