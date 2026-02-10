'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { InvoiceStatusBadge, LockedBadge } from '@/components/invoices/InvoiceStatusBadge';
import { formatMonth, formatCurrency } from '@/lib/invoice-utils';
import { ExternalLink } from 'lucide-react';

interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  billingMonth: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED' | 'LOCKED';
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  lockedAt: string | null;
  createdAt: string;
}

interface CustomerInvoicesTabProps {
  customerId: string;
}

export function CustomerInvoicesTab({ customerId }: CustomerInvoicesTabProps) {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await api.get<{ data: CustomerInvoice[] }>(`/invoices?customerId=${customerId}`);
      setInvoices(response.data || []);
    } catch (err) {
      console.error('Error fetching invoices:', err);
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const columns: ColumnDef<CustomerInvoice>[] = useMemo(
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
        accessorKey: 'billingMonth',
        header: 'Billing Month',
        cell: ({ row }) => formatMonth(row.original.billingMonth),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <InvoiceStatusBadge status={row.original.status} size="sm" />
            <LockedBadge lockedAt={row.original.lockedAt} size="sm" />
          </div>
        ),
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total',
        cell: ({ row }) => (
          <span className="font-medium">
            {formatCurrency(row.original.totalAmount, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: 'issueDate',
        header: 'Issue Date',
        cell: ({ row }) =>
          row.original.issueDate
            ? new Date(row.original.issueDate).toLocaleDateString()
            : '-',
      },
      {
        accessorKey: 'dueDate',
        header: 'Due Date',
        cell: ({ row }) =>
          row.original.dueDate
            ? new Date(row.original.dueDate).toLocaleDateString()
            : '-',
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

  // Calculate totals
  const totals = useMemo(() => {
    const total = invoices.reduce((sum, inv) => sum + parseFloat(inv.totalAmount), 0);
    const paid = invoices
      .filter((inv) => inv.status === 'PAID')
      .reduce((sum, inv) => sum + parseFloat(inv.totalAmount), 0);
    const outstanding = invoices
      .filter((inv) => inv.status === 'ISSUED')
      .reduce((sum, inv) => sum + parseFloat(inv.totalAmount), 0);
    return { total, paid, outstanding };
  }, [invoices]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Invoiced</p>
          <p className="text-2xl font-bold">{formatCurrency(totals.total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Paid</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(totals.paid)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Outstanding</p>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{formatCurrency(totals.outstanding)}</p>
        </Card>
      </div>

      {/* Invoices Table */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Invoices</h3>
          <Link href={`/invoices?customerId=${customerId}`}>
            <Button variant="outline" size="sm">
              View All
              <ExternalLink className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>

        <DataTable
          data={invoices}
          columns={columns}
          isLoading={isLoading}
          emptyMessage="No invoices for this customer"
          pageSize={10}
        />
      </Card>
    </div>
  );
}
