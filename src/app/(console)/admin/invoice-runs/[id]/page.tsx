'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable, Button, Alert } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Can } from '@/components/auth';
import { ArrowLeft, Play, ExternalLink, AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';

interface InvoiceRunInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerExternalId: string | null;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED';
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  lockedAt: string | null;
  createdAt: string;
}

interface InvoiceRunDetail {
  id: string;
  billingMonth: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'LOCKED';
  configSnapshotId: string | null;
  createdBy: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  totalInvoices: number;
  totalAmount: string | null;
  sourceKey: string | null;
  customerCount: number | null;
  projectCount: number | null;
  rowCount: number | null;
  currencyBreakdown: Record<string, number> | null;
  createdAt: string;
  updatedAt: string;
  invoices: InvoiceRunInvoice[];
}

export default function InvoiceRunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [invoiceRun, setInvoiceRun] = useState<InvoiceRunDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExecuteConfirm, setShowExecuteConfirm] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const fetchInvoiceRun = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<InvoiceRunDetail>(`/invoice-runs/${id}`);
      setInvoiceRun(response);
    } catch (err) {
      console.error('Error fetching invoice run:', err);
      setError('Failed to load invoice run');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInvoiceRun();
  }, [fetchInvoiceRun]);

  // Auto-refresh while RUNNING
  useEffect(() => {
    if (invoiceRun?.status === 'RUNNING') {
      const interval = setInterval(fetchInvoiceRun, 5000);
      return () => clearInterval(interval);
    }
  }, [invoiceRun?.status, fetchInvoiceRun]);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      await api.post(`/invoice-runs/${id}/execute`);
      setShowExecuteConfirm(false);
      fetchInvoiceRun();
    } catch (err) {
      console.error('Error executing invoice run:', err);
      setError('Failed to execute invoice run');
    } finally {
      setIsExecuting(false);
    }
  };

  const formatMonth = (month: string): string => {
    const [year, monthNum] = month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  };

  const formatCurrency = (value: string | number): string => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SUCCEEDED':
      case 'LOCKED':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'FAILED':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'RUNNING':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'QUEUED':
      default:
        return <Clock className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variant = status === 'SUCCEEDED' || status === 'LOCKED'
      ? 'default'
      : status === 'FAILED'
        ? 'destructive'
        : status === 'RUNNING'
          ? 'secondary'
          : 'outline';
    return <Badge variant={variant}>{status}</Badge>;
  };

  const columns: ColumnDef<InvoiceRunInvoice>[] = useMemo(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: 'Invoice #',
        cell: ({ row }) => (
          <Link
            href={`/invoices/${row.original.id}`}
            className="text-primary hover:text-primary/80 font-medium"
          >
            {row.original.invoiceNumber}
          </Link>
        ),
      },
      {
        accessorKey: 'customerName',
        header: 'Customer',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.customerName}</p>
            {row.original.customerExternalId && (
              <p className="text-xs text-muted-foreground">{row.original.customerExternalId}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.original.status;
          const variant = status === 'PAID' ? 'default' : status === 'ISSUED' ? 'secondary' : status === 'CANCELLED' ? 'destructive' : 'outline';
          return (
            <div className="flex items-center gap-2">
              <Badge variant={variant}>{status}</Badge>
              {row.original.lockedAt && (
                <Badge variant="outline" className="text-xs">Locked</Badge>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total',
        cell: ({ row }) => (
          <span className="font-medium">
            {formatCurrency(row.original.totalAmount)}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Link href={`/invoices/${row.original.id}`}>
            <Button variant="ghost" size="sm">
              <ExternalLink className="h-4 w-4 mr-1" />
              View
            </Button>
          </Link>
        ),
      },
    ],
    []
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!invoiceRun) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Invoice run not found</p>
        <Link href="/admin/invoice-runs">
          <Button variant="secondary" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Invoice Runs
          </Button>
        </Link>
      </div>
    );
  }

  const duration = invoiceRun.startedAt && invoiceRun.finishedAt
    ? Math.round((new Date(invoiceRun.finishedAt).getTime() - new Date(invoiceRun.startedAt).getTime()) / 1000)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/admin/invoice-runs">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {getStatusIcon(invoiceRun.status)}
            <h1 className="text-2xl font-bold">{formatMonth(invoiceRun.billingMonth)}</h1>
            {getStatusBadge(invoiceRun.status)}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Created {new Date(invoiceRun.createdAt).toLocaleString()}
            {invoiceRun.createdBy && ` by ${invoiceRun.createdBy.firstName || invoiceRun.createdBy.email}`}
          </p>
        </div>

        {/* Actions */}
        <Can resource="invoice_runs" action="execute">
          {invoiceRun.status === 'QUEUED' && (
            <Button onClick={() => setShowExecuteConfirm(true)}>
              <Play className="h-4 w-4 mr-2" />
              Execute Run
            </Button>
          )}
        </Can>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Error Message */}
      {invoiceRun.errorMessage && (
        <Alert variant="error">
          <strong>Error:</strong> {invoiceRun.errorMessage}
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Invoices</p>
          <p className="text-2xl font-bold">{invoiceRun.totalInvoices}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Amount</p>
          <p className="text-2xl font-bold">
            {invoiceRun.totalAmount ? formatCurrency(invoiceRun.totalAmount) : '-'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Customers</p>
          <p className="text-2xl font-bold">{invoiceRun.customerCount ?? '-'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Cost Rows</p>
          <p className="text-2xl font-bold">{invoiceRun.rowCount?.toLocaleString() ?? '-'}</p>
        </Card>
      </div>

      {/* Metadata */}
      <Card>
        <h3 className="text-lg font-semibold mb-4">Run Details</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Started</p>
            <p className="font-medium">
              {invoiceRun.startedAt ? new Date(invoiceRun.startedAt).toLocaleString() : '-'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Finished</p>
            <p className="font-medium">
              {invoiceRun.finishedAt ? new Date(invoiceRun.finishedAt).toLocaleString() : '-'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Duration</p>
            <p className="font-medium">
              {duration !== null ? `${duration}s` : '-'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Projects</p>
            <p className="font-medium">{invoiceRun.projectCount ?? '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Source Key</p>
            <p className="font-medium font-mono text-xs">
              {invoiceRun.sourceKey || '-'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Config Snapshot</p>
            <p className="font-medium font-mono text-xs">
              {invoiceRun.configSnapshotId ? invoiceRun.configSnapshotId.slice(0, 8) : '-'}
            </p>
          </div>
        </div>

        {/* Currency Breakdown */}
        {invoiceRun.currencyBreakdown && Object.keys(invoiceRun.currencyBreakdown).length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-muted-foreground mb-2">Currency Breakdown</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(invoiceRun.currencyBreakdown).map(([currency, amount]) => (
                <Badge key={currency} variant="secondary">
                  {currency}: {formatCurrency(amount)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Generated Invoices */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Generated Invoices</h3>
          <p className="text-sm text-muted-foreground">
            {invoiceRun.invoices.length} invoice{invoiceRun.invoices.length !== 1 ? 's' : ''}
          </p>
        </div>

        <DataTable
          data={invoiceRun.invoices}
          columns={columns}
          isLoading={false}
          searchable
          searchPlaceholder="Search invoices..."
          emptyMessage={
            invoiceRun.status === 'QUEUED'
              ? 'Run has not been executed yet'
              : invoiceRun.status === 'RUNNING'
                ? 'Run is in progress...'
                : 'No invoices generated'
          }
          pageSize={20}
        />
      </Card>

      {/* Execute Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showExecuteConfirm}
        onClose={() => setShowExecuteConfirm(false)}
        onConfirm={handleExecute}
        title="Execute Invoice Run"
        message="This will generate invoices for all customers based on cost data. This action may take a few minutes. Continue?"
        confirmText="Execute"
        isLoading={isExecuting}
      />
    </div>
  );
}
