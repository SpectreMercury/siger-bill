'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { InvoiceDetail } from '@/lib/client/invoice-types';
import { Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/shadcn/card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import { InvoiceStatusBadge, LockedBadge } from '@/components/invoices/InvoiceStatusBadge';
import { InvoiceSummaryCards } from '@/components/invoices/InvoiceSummaryCards';
import { InvoiceBreakdownTable } from '@/components/invoices/InvoiceBreakdownTable';
import {
  formatMonth,
  formatDate,
  formatDateTime,
  exportInvoice,
  canLockInvoice,
  canExportInvoice,
} from '@/lib/invoice-utils';
import { ArrowLeft, Lock, FileText, AlertTriangle, Loader2 } from 'lucide-react';

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  const fetchInvoice = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<InvoiceDetail>(`/invoices/${invoiceId}`);
      setInvoice(response);
    } catch (err: unknown) {
      console.error('Error fetching invoice:', err);
      // Handle specific error codes
      if (err && typeof err === 'object' && 'status' in err) {
        const apiErr = err as { status: number; message?: string };
        if (apiErr.status === 404) {
          setError('Invoice not found');
        } else if (apiErr.status === 403) {
          setError('You do not have permission to view this invoice');
        } else {
          setError(apiErr.message || 'Failed to load invoice');
        }
      } else {
        setError('Failed to load invoice');
      }
    } finally {
      setIsLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleLock = async () => {
    setIsLocking(true);
    try {
      await api.post(`/invoices/${invoiceId}/lock`);
      await fetchInvoice();
      setShowLockDialog(false);
    } catch (err: unknown) {
      console.error('Error locking invoice:', err);
      // Handle 409 conflict (already locked)
      if (err && typeof err === 'object' && 'status' in err) {
        const apiErr = err as { status: number; message?: string };
        if (apiErr.status === 409) {
          setError('Invoice is already locked');
        } else {
          setError(apiErr.message || 'Failed to lock invoice');
        }
      } else {
        setError('Failed to lock invoice');
      }
    } finally {
      setIsLocking(false);
    }
  };

  const handleExport = async (format: 'pdf' | 'xlsx' | 'csv') => {
    try {
      await exportInvoice(invoiceId, format);
    } catch (err) {
      console.error('Export error:', err);
      setError(err instanceof Error ? err.message : 'Failed to export invoice');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error === 'Invoice not found' || !invoice) {
    return (
      <div className="text-center py-12">
        <FileText className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Invoice Not Found</h2>
        <p className="text-muted-foreground mb-4">The invoice you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/invoices">
          <Button>Back to Invoices</Button>
        </Link>
      </div>
    );
  }

  if (error === 'You do not have permission to view this invoice') {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-16 w-16 mx-auto text-destructive/50 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground mb-4">You do not have permission to view this invoice.</p>
        <Link href="/invoices">
          <Button>Back to Invoices</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/invoices">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Invoice {invoice.invoiceNumber}</h1>
              <InvoiceStatusBadge status={invoice.status} />
              <LockedBadge lockedAt={invoice.lockedAt} />
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              {invoice.customer?.name} • {formatMonth(invoice.billingMonth)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Lock Button */}
          <Can resource="invoices" action="lock">
            {canLockInvoice(invoice.status, invoice.lockedAt) && (
              <Button variant="outline" onClick={() => setShowLockDialog(true)}>
                <Lock className="h-4 w-4 mr-1" />
                Lock Invoice
              </Button>
            )}
          </Can>

          {/* Export Buttons */}
          <Can resource="invoices" action="export">
            {canExportInvoice(invoice.lockedAt) && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => handleExport('csv')}>
                  CSV
                </Button>
                <Button variant="outline" onClick={() => handleExport('xlsx')}>
                  Excel
                </Button>
                <Button onClick={() => handleExport('pdf')}>
                  PDF
                </Button>
              </div>
            )}
          </Can>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <InvoiceSummaryCards
        listAmount={invoice.listAmount}
        discountAmount={invoice.discountAmount}
        tierDiscountAmount={invoice.tierDiscountAmount}
        creditAmount={invoice.creditAmount}
        subtotal={invoice.subtotal}
        taxAmount={invoice.taxAmount}
        totalAmount={invoice.totalAmount}
        currency={invoice.currency}
      />

      {/* Invoice Details & Customer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Invoice Number</label>
                <p className="mt-1 font-medium">{invoice.invoiceNumber}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Billing Month</label>
                <p className="mt-1 font-medium">{formatMonth(invoice.billingMonth)}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Currency</label>
                <p className="mt-1 font-medium">{invoice.currency}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Issue Date</label>
                <p className="mt-1 font-medium">{formatDate(invoice.issueDate)}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Due Date</label>
                <p className="mt-1 font-medium">{formatDate(invoice.dueDate)}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Created</label>
                <p className="mt-1 font-medium">{formatDateTime(invoice.createdAt)}</p>
              </div>
              {invoice.lockedAt && (
                <div className="col-span-2 pt-2 border-t">
                  <label className="text-sm text-muted-foreground">Locked</label>
                  <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
                    {formatDateTime(invoice.lockedAt)}
                    {invoice.lockedBy && <span className="text-muted-foreground"> by {invoice.lockedBy}</span>}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Customer Card */}
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Name</label>
                <p className="mt-1 font-medium">{invoice.customer?.name}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">External ID</label>
                <p className="mt-1 font-medium">{invoice.customer?.externalId || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Currency</label>
                <p className="mt-1 font-medium">{invoice.customer?.currency}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Customer ID</label>
                <p className="mt-1 font-medium text-xs text-muted-foreground">{invoice.customerId}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdown Table (Aggregated) */}
      <InvoiceBreakdownTable lineItems={invoice.lineItems || []} currency={invoice.currency} />

      {/* Notes */}
      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Lock Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showLockDialog}
        onClose={() => setShowLockDialog(false)}
        onConfirm={handleLock}
        title="Lock Invoice"
        message="Are you sure you want to lock this invoice? This action cannot be undone. Once locked, the invoice can be exported but not modified."
        confirmText="Lock Invoice"
        isLoading={isLocking}
      />
    </div>
  );
}
