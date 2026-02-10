'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { InvoiceRun, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import { ExternalLink } from 'lucide-react';

export default function InvoiceRunsPage() {
  const router = useRouter();
  const [invoiceRuns, setInvoiceRuns] = useState<InvoiceRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [billingMonth, setBillingMonth] = useState('');
  const [provider, setProvider] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [executeId, setExecuteId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const fetchInvoiceRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<PaginatedResponse<InvoiceRun>>('/invoice-runs');
      setInvoiceRuns(response.data || []);
    } catch (err) {
      console.error('Error fetching invoice runs:', err);
      setError('Failed to load invoice runs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoiceRuns();
  }, [fetchInvoiceRuns]);

  const columns: ColumnDef<InvoiceRun>[] = useMemo(
    () => [
      {
        accessorKey: 'billingMonth',
        header: 'Billing Month',
        cell: ({ row }) => (
          <Link
            href={`/admin/invoice-runs/${row.original.id}`}
            className="text-primary hover:text-primary/80 font-medium"
          >
            {formatMonth(row.original.billingMonth)}
          </Link>
        ),
      },
      {
        accessorKey: 'provider',
        header: 'Provider',
        cell: ({ row }) => row.original.provider || 'All',
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.original.status;
          const variant = status === 'SUCCEEDED' ? 'default' : status === 'FAILED' ? 'destructive' : status === 'RUNNING' ? 'secondary' : 'outline';
          return <Badge variant={variant}>{status}</Badge>;
        },
      },
      {
        accessorKey: 'totalInvoices',
        header: 'Invoices',
        cell: ({ row }) => row.original.totalInvoices || 0,
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total Amount',
        cell: ({ row }) =>
          row.original.totalAmount ? formatCurrency(row.original.totalAmount) : '-',
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Can resource="invoice_runs" action="execute">
              {row.original.status === 'QUEUED' && (
                <Button variant="primary" size="sm" onClick={() => setExecuteId(row.original.id)}>
                  Execute
                </Button>
              )}
            </Can>
            {row.original.status === 'FAILED' && row.original.errorMessage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => alert(row.original.errorMessage)}
                className="text-red-600"
              >
                View Error
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/admin/invoice-runs/${row.original.id}`)}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Details
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const handleCreate = async () => {
    if (!billingMonth) return;
    setIsSaving(true);

    try {
      await api.post('/invoice-runs', {
        billingMonth,
        provider: provider || undefined,
      });
      setShowCreateModal(false);
      setBillingMonth('');
      setProvider('');
      fetchInvoiceRuns();
    } catch (err) {
      console.error('Error creating invoice run:', err);
      setError('Failed to create invoice run');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExecute = async () => {
    if (!executeId) return;
    setIsExecuting(true);

    try {
      await api.post(`/invoice-runs/${executeId}/execute`);
      setExecuteId(null);
      fetchInvoiceRuns();
    } catch (err) {
      console.error('Error executing invoice run:', err);
      setError('Failed to execute invoice run');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invoice Runs</h1>
          <p className="text-muted-foreground text-sm mt-1">Generate and manage billing cycles</p>
        </div>
        <Can resource="invoice_runs" action="create">
          <Button onClick={() => setShowCreateModal(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Invoice Run
          </Button>
        </Can>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Table */}
      <Card>
        <DataTable
          data={invoiceRuns}
          columns={columns}
          isLoading={isLoading}
          emptyMessage="No invoice runs found"
          pageSize={20}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="New Invoice Run"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="billingMonth">Billing Month *</Label>
            <Input
              id="billingMonth"
              type="month"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              required
              className="mt-1"
            />
          </div>

          <div>
            <Label>Provider (optional)</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="All Providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Providers</SelectItem>
                <SelectItem value="GCP">GCP</SelectItem>
                <SelectItem value="AWS">AWS</SelectItem>
                <SelectItem value="AZURE">Azure</SelectItem>
                <SelectItem value="OPENAI">OpenAI</SelectItem>
                <SelectItem value="CUSTOM">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} isLoading={isSaving} disabled={!billingMonth}>
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* Execute Confirmation */}
      <ConfirmDialog
        isOpen={!!executeId}
        onClose={() => setExecuteId(null)}
        onConfirm={handleExecute}
        title="Execute Invoice Run"
        message="This will generate invoices for all customers based on cost data. This action may take a few minutes. Continue?"
        confirmText="Execute"
        isLoading={isExecuting}
      />
    </div>
  );
}

function formatMonth(month: string): string {
  const [year, monthNum] = month.split('-');
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

function formatCurrency(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}
