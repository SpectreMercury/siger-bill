'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { InvoiceListItem, InvoiceListResponse, InvoiceFilters } from '@/lib/client/invoice-types';
import { DataTable, Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Can } from '@/components/auth';
import { InvoiceFilterBar } from '@/components/invoices/InvoiceFilterBar';
import { InvoiceStatusBadge, LockedBadge } from '@/components/invoices/InvoiceStatusBadge';
import { formatMonth, formatCurrency, exportInvoice } from '@/lib/invoice-utils';

export default function InvoicesPage() {
  const t = useTranslations('invoices');
  const tc = useTranslations('common');
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<InvoiceFilters>({});
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.from) params.append('from', filters.from);
      if (filters.to) params.append('to', filters.to);
      if (filters.status) params.append('status', filters.status);
      if (filters.locked === 'locked') params.append('locked', 'true');
      if (filters.locked === 'unlocked') params.append('locked', 'false');
      if (filters.customerId) params.append('customerId', filters.customerId);
      params.append('page', pagination.page.toString());
      params.append('pageSize', pagination.pageSize.toString());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await api.get<any>(`/invoices?${params.toString()}`);

      // Transform API response to match frontend types
      // API returns nested customer object, frontend expects flat customerName/customerExternalId
      const transformedData = (response.data || []).map((inv: {
        customer?: { name?: string; externalId?: string };
        [key: string]: unknown;
      }) => ({
        ...inv,
        customerName: inv.customer?.name || '',
        customerExternalId: inv.customer?.externalId || undefined,
      })) as InvoiceListItem[];

      setInvoices(transformedData);
      if (response.pagination) {
        // Handle API returning 'limit' instead of 'pageSize'
        const pag = response.pagination as { page: number; limit?: number; pageSize?: number; total: number; totalPages: number };
        setPagination({
          page: pag.page,
          pageSize: pag.pageSize || pag.limit || 20,
          total: pag.total,
          totalPages: pag.totalPages,
        });
      }
    } catch (err) {
      console.error('Error fetching invoices:', err);
      setError('Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  }, [filters, pagination.page, pagination.pageSize]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleFiltersChange = useCallback((newFilters: InvoiceFilters) => {
    setFilters(newFilters);
    setPagination((prev) => ({ ...prev, page: 1 })); // Reset to first page
  }, []);

  const handleExport = async (invoiceId: string, format: 'pdf' | 'xlsx' | 'csv') => {
    try {
      await exportInvoice(invoiceId, format);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export invoice');
    }
  };

  const columns: ColumnDef<InvoiceListItem>[] = useMemo(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: t('invoiceNumber'),
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
        header: t('customer'),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.customerName}</div>
            {row.original.customerExternalId && (
              <div className="text-xs text-muted-foreground">{row.original.customerExternalId}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'billingMonth',
        header: t('billingMonth'),
        cell: ({ row }) => formatMonth(row.original.billingMonth),
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <InvoiceStatusBadge status={row.original.status} size="sm" />
            <LockedBadge lockedAt={row.original.lockedAt} size="sm" />
          </div>
        ),
      },
      {
        accessorKey: 'totalAmount',
        header: t('total'),
        cell: ({ row }) => (
          <span className="font-medium">
            {formatCurrency(row.original.totalAmount, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: 'issueDate',
        header: t('issueDate'),
        cell: ({ row }) =>
          row.original.issueDate
            ? new Date(row.original.issueDate).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : '-',
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link href={`/invoices/${row.original.id}`}>
              <Button variant="ghost" size="sm">
                {tc('view')}
              </Button>
            </Link>
            <Can resource="invoices" action="export">
              {row.original.lockedAt && (
                <div className="relative group">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleExport(row.original.id, 'pdf')}
                  >
                    {tc('export')}
                  </Button>
                </div>
              )}
            </Can>
          </div>
        ),
      },
    ],
    [t, tc]
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {/* Filters */}
      <InvoiceFilterBar onFiltersChange={handleFiltersChange} />

      {/* Error */}
      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary Stats */}
      {!isLoading && invoices.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label={t('summary.totalInvoices')}
            value={pagination.total.toString()}
          />
          <SummaryCard
            label={t('summary.draft')}
            value={invoices.filter((i) => i.status === 'DRAFT').length.toString()}
            color="gray"
          />
          <SummaryCard
            label={t('summary.issued')}
            value={invoices.filter((i) => i.status === 'ISSUED').length.toString()}
            color="blue"
          />
          <SummaryCard
            label={t('summary.paid')}
            value={invoices.filter((i) => i.status === 'PAID').length.toString()}
            color="green"
          />
        </div>
      )}

      {/* Table */}
      <Card>
        <DataTable
          data={invoices}
          columns={columns}
          isLoading={isLoading}
          searchable={false}
          emptyMessage={t('noInvoices')}
          pageSize={pagination.pageSize}
        />
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Card className="flex items-center justify-between px-4 py-3">
          <div className="text-sm text-muted-foreground">
            {tc('showing')} {(pagination.page - 1) * pagination.pageSize + 1} - {' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} {tc('of')}{' '}
            {pagination.total}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
            >
              {tc('previous')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {tc('page')} {pagination.page} {tc('of')} {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === pagination.totalPages}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
            >
              {tc('next')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  color?: 'gray' | 'blue' | 'green' | 'red' | 'purple';
}

function SummaryCard({ label, value, color = 'gray' }: SummaryCardProps) {
  const colorClasses = {
    gray: 'bg-muted border-border',
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
  };

  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
