/**
 * Invoice utility functions
 */

import { InvoiceStatus, ExportFormat } from './client/invoice-types';
import { getAuthToken } from './client/api';

/**
 * Status display configurations
 */
export const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; bgColor: string }> = {
  DRAFT: { label: 'Draft', color: 'text-gray-700 dark:text-gray-300', bgColor: 'bg-gray-100 dark:bg-gray-800' },
  ISSUED: { label: 'Issued', color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  PAID: { label: 'Paid', color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  CANCELLED: { label: 'Cancelled', color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  LOCKED: { label: 'Locked', color: 'text-purple-700 dark:text-purple-300', bgColor: 'bg-purple-100 dark:bg-purple-900/30' },
};

/**
 * Get status display info
 */
export function getStatusInfo(status: InvoiceStatus) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.DRAFT;
}

/**
 * Check if invoice can be exported (must be locked)
 */
export function canExportInvoice(lockedAt: string | null): boolean {
  return lockedAt !== null;
}

/**
 * Check if invoice can be locked
 */
export function canLockInvoice(status: InvoiceStatus, lockedAt: string | null): boolean {
  return lockedAt === null && status !== 'CANCELLED';
}

/**
 * Format invoice number for display
 */
export function formatInvoiceNumber(invoiceNumber: string): string {
  return invoiceNumber;
}

/**
 * Export invoice - opens in new tab or downloads blob
 */
export async function exportInvoice(invoiceId: string, format: ExportFormat): Promise<void> {
  const token = getAuthToken();
  const url = `/api/invoices/${invoiceId}/export?format=${format}`;

  // For PDF, open in new tab
  if (format === 'pdf') {
    // Create a form to submit with auth header
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = url;
    form.target = '_blank';

    // Add token as query param for export (backend should accept both header and query)
    const tokenInput = document.createElement('input');
    tokenInput.type = 'hidden';
    tokenInput.name = 'token';
    tokenInput.value = token || '';
    form.appendChild(tokenInput);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    return;
  }

  // For other formats, fetch and download
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Export failed');
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = `invoice-${invoiceId}.${format}`;

    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    }

    // Trigger download
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Export error:', error);
    throw error;
  }
}

/**
 * Get current month in YYYY-MM format
 */
export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format month for display
 */
export function formatMonth(month: string): string {
  if (!month) return '-';
  const [year, monthNum] = month.split('-');
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

/**
 * Format currency
 */
export function formatCurrency(value: string | number, currency = 'USD'): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format date
 */
export function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date time
 */
export function formatDateTime(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
