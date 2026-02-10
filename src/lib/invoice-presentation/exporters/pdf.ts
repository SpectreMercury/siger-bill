/**
 * PDF Exporter (Phase 6)
 *
 * Exports invoice to PDF format with customer-facing layout.
 * Uses HTML template rendered to PDF.
 *
 * Note: In production, use a library like 'puppeteer', 'pdfmake', or 'jspdf'
 * This implementation provides an HTML template that can be converted to PDF.
 */

import { InvoicePresentation, ExportResult, ExportOptions, CreditBreakdown } from '../types';
import { generateContentHash } from '../builder';

/**
 * Format decimal for display
 */
function formatCurrency(value: { toString: () => string }, currency: string): string {
  const num = parseFloat(value.toString());
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency === 'MIXED' ? 'USD' : currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * Generate HTML invoice template
 */
function generateInvoiceHTML(
  presentation: InvoicePresentation,
  creditsBreakdown?: CreditBreakdown[]
): string {
  const currency = presentation.summary.currency === 'MIXED' ? 'USD' : presentation.summary.currency;

  // Generate line items rows
  const lineItemsHTML = presentation.rows
    .map(
      (row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHTML(row.description)}</td>
        <td class="number">${parseFloat(row.usage.quantity.toString()).toFixed(2)}</td>
        <td>${row.usage.unit}</td>
        <td class="money">${formatCurrency(row.amounts.listAmount, currency)}</td>
        <td class="money discount">${row.amounts.discountAmount.toString() !== '0' ? `-${formatCurrency(row.amounts.discountAmount, currency)}` : '-'}</td>
        <td class="money">${formatCurrency(row.amounts.netAmount, currency)}</td>
      </tr>
    `
    )
    .join('');

  // Generate credits section if applicable
  let creditsHTML = '';
  if (creditsBreakdown && creditsBreakdown.length > 0) {
    const creditRows = creditsBreakdown
      .map(
        (credit) => `
        <tr>
          <td>${escapeHTML(credit.description)}</td>
          <td>${credit.creditType}</td>
          <td class="money">${formatCurrency(credit.appliedAmount, currency)}</td>
        </tr>
      `
      )
      .join('');

    creditsHTML = `
      <div class="section credits-section">
        <h3>Credits Applied</h3>
        <table class="credits-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Type</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${creditRows}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${presentation.header.invoiceNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #333;
      background: #fff;
      padding: 40px;
    }

    .invoice-container {
      max-width: 800px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid #2563eb;
    }

    .company-info h1 {
      font-size: 24px;
      color: #2563eb;
      margin-bottom: 10px;
    }

    .company-info p {
      color: #666;
      font-size: 11px;
    }

    .invoice-info {
      text-align: right;
    }

    .invoice-info h2 {
      font-size: 28px;
      color: #333;
      margin-bottom: 10px;
    }

    .invoice-info .invoice-number {
      font-size: 14px;
      font-weight: bold;
      color: #2563eb;
    }

    .invoice-info .invoice-date {
      color: #666;
      margin-top: 5px;
    }

    .addresses {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
    }

    .address-block {
      width: 45%;
    }

    .address-block h3 {
      font-size: 11px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 10px;
      letter-spacing: 1px;
    }

    .address-block p {
      font-size: 12px;
      line-height: 1.6;
    }

    .address-block .name {
      font-weight: bold;
      font-size: 14px;
    }

    .section {
      margin-bottom: 30px;
    }

    .line-items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }

    .line-items-table th {
      background: #f8fafc;
      padding: 12px 10px;
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      color: #64748b;
      border-bottom: 2px solid #e2e8f0;
    }

    .line-items-table td {
      padding: 12px 10px;
      border-bottom: 1px solid #e2e8f0;
    }

    .line-items-table .number,
    .line-items-table .money {
      text-align: right;
    }

    .line-items-table .discount {
      color: #16a34a;
    }

    .totals {
      float: right;
      width: 300px;
    }

    .totals-table {
      width: 100%;
      border-collapse: collapse;
    }

    .totals-table td {
      padding: 8px 10px;
    }

    .totals-table .label {
      text-align: left;
      color: #666;
    }

    .totals-table .value {
      text-align: right;
      font-weight: 500;
    }

    .totals-table .subtotal-row td {
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
    }

    .totals-table .discount-value {
      color: #16a34a;
    }

    .totals-table .total-row td {
      border-top: 2px solid #2563eb;
      padding-top: 12px;
      font-size: 16px;
      font-weight: bold;
    }

    .totals-table .total-row .value {
      color: #2563eb;
    }

    .credits-section {
      clear: both;
      padding-top: 20px;
    }

    .credits-section h3 {
      font-size: 14px;
      margin-bottom: 10px;
      color: #333;
    }

    .credits-table {
      width: 50%;
      border-collapse: collapse;
    }

    .credits-table th {
      background: #f0fdf4;
      padding: 8px 10px;
      text-align: left;
      font-size: 11px;
      color: #166534;
      border-bottom: 1px solid #bbf7d0;
    }

    .credits-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #e2e8f0;
    }

    .credits-table .money {
      text-align: right;
      color: #16a34a;
    }

    .footer {
      clear: both;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
    }

    .payment-info {
      margin-bottom: 20px;
    }

    .payment-info h3 {
      font-size: 12px;
      margin-bottom: 10px;
      color: #333;
    }

    .payment-info p {
      font-size: 11px;
      color: #666;
      line-height: 1.8;
    }

    .terms {
      font-size: 10px;
      color: #94a3b8;
      line-height: 1.6;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
    }

    .status-DRAFT { background: #fef3c7; color: #92400e; }
    .status-SENT { background: #dbeafe; color: #1e40af; }
    .status-PAID { background: #d1fae5; color: #065f46; }
    .status-LOCKED { background: #e2e8f0; color: #475569; }
    .status-OVERDUE { background: #fee2e2; color: #991b1b; }

    @media print {
      body { padding: 20px; }
      .invoice-container { max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div class="company-info">
        <h1>${escapeHTML(presentation.billingEntity.name)}</h1>
        <p>${escapeHTML(presentation.billingEntity.address)}</p>
        ${presentation.billingEntity.taxId ? `<p>Tax ID: ${escapeHTML(presentation.billingEntity.taxId)}</p>` : ''}
      </div>
      <div class="invoice-info">
        <h2>INVOICE</h2>
        <p class="invoice-number">${escapeHTML(presentation.header.invoiceNumber)}</p>
        <p class="invoice-date">Date: ${formatDate(presentation.header.invoiceDate)}</p>
        <p class="invoice-date">Due: ${formatDate(presentation.header.dueDate)}</p>
        <p style="margin-top: 10px;">
          <span class="status-badge status-${presentation.header.status}">${presentation.header.status}</span>
        </p>
      </div>
    </div>

    <div class="addresses">
      <div class="address-block">
        <h3>Bill To</h3>
        <p class="name">${escapeHTML(presentation.customer.name)}</p>
        ${presentation.customer.address ? `<p>${escapeHTML(presentation.customer.address)}</p>` : ''}
        ${presentation.customer.contactEmail ? `<p>${escapeHTML(presentation.customer.contactEmail)}</p>` : ''}
        ${presentation.customer.taxId ? `<p>Tax ID: ${escapeHTML(presentation.customer.taxId)}</p>` : ''}
      </div>
      <div class="address-block">
        <h3>Billing Period</h3>
        <p class="name">${escapeHTML(presentation.header.billingMonth)}</p>
        <p>Invoice Run: ${escapeHTML(presentation.audit.invoiceRunId.slice(0, 8))}...</p>
      </div>
    </div>

    <div class="section">
      <table class="line-items-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Description</th>
            <th style="width: 80px;">Qty</th>
            <th style="width: 80px;">Unit</th>
            <th style="width: 100px;">List Price</th>
            <th style="width: 100px;">Discount</th>
            <th style="width: 100px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemsHTML}
        </tbody>
      </table>

      <div class="totals">
        <table class="totals-table">
          <tr class="subtotal-row">
            <td class="label">Subtotal</td>
            <td class="value">${formatCurrency(presentation.summary.subtotal, currency)}</td>
          </tr>
          ${presentation.summary.totalDiscount.toString() !== '0' ? `
          <tr>
            <td class="label">Discount</td>
            <td class="value discount-value">-${formatCurrency(presentation.summary.totalDiscount, currency)}</td>
          </tr>
          ` : ''}
          ${presentation.summary.totalCredits.toString() !== '0' ? `
          <tr>
            <td class="label">Credits Applied</td>
            <td class="value discount-value">-${formatCurrency(presentation.summary.totalCredits, currency)}</td>
          </tr>
          ` : ''}
          ${presentation.summary.taxAmount.toString() !== '0' ? `
          <tr>
            <td class="label">Tax</td>
            <td class="value">${formatCurrency(presentation.summary.taxAmount, currency)}</td>
          </tr>
          ` : ''}
          <tr class="total-row">
            <td class="label">Total Due</td>
            <td class="value">${formatCurrency(presentation.summary.grandTotal, currency)}</td>
          </tr>
        </table>
      </div>
    </div>

    ${creditsHTML}

    <div class="footer">
      <div class="payment-info">
        <h3>Payment Information</h3>
        <p>Payment Terms: Net ${presentation.paymentTerms.days} days</p>
        ${presentation.billingEntity.bankDetails ? `<p>${escapeHTML(presentation.billingEntity.bankDetails)}</p>` : ''}
        <p>${escapeHTML(presentation.paymentTerms.instructions || '')}</p>
      </div>

      ${presentation.notes ? `<p style="margin-bottom: 10px;"><strong>Notes:</strong> ${escapeHTML(presentation.notes)}</p>` : ''}

      <p class="terms">${escapeHTML(presentation.terms || '')}</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Escape HTML special characters
 */
function escapeHTML(str: string | undefined | null): string {
  if (str === undefined || str === null) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Export invoice to PDF format
 * Returns HTML that can be rendered to PDF by a PDF library or browser
 */
export function exportToPDF(
  presentation: InvoicePresentation,
  options: ExportOptions = { format: 'pdf' },
  creditsBreakdown?: CreditBreakdown[]
): ExportResult {
  const html = generateInvoiceHTML(presentation, creditsBreakdown);
  const buffer = Buffer.from(html, 'utf-8');
  const contentHash = generateContentHash(buffer);

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `invoice-${presentation.header.invoiceNumber}-${dateStr}.html`;

  return {
    content: buffer,
    // Return HTML for now - in production, use puppeteer or similar to generate actual PDF
    mimeType: 'text/html',
    filename,
    contentHash,
    metadata: {
      format: 'pdf',
      rowCount: presentation.rows.length,
      generatedAt: new Date(),
      invoiceNumber: presentation.header.invoiceNumber,
    },
  };
}
