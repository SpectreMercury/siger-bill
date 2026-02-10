'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Plus, CreditCard, DollarSign, FileText, Calendar } from 'lucide-react';

interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customer: {
    id: string;
    name: string;
    externalId: string | null;
  };
  amount: string;
  currency: string;
  paymentDate: string;
  reference: string | null;
  method: string | null;
  notes: string | null;
  recordedBy: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  totalAmount: string;
  paidAmount: string;
  remainingBalance: string;
  status: string;
}

interface PaymentFormData {
  invoiceId: string;
  amount: string;
  currency: string;
  paymentDate: string;
  reference: string;
  method: string;
  notes: string;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Create payment modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unpaidInvoices, setUnpaidInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [formData, setFormData] = useState<PaymentFormData>({
    invoiceId: '',
    amount: '',
    currency: 'USD',
    paymentDate: new Date().toISOString().split('T')[0],
    reference: '',
    method: '',
    notes: '',
  });

  const fetchPayments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const response = await api.get<{
        data: Payment[];
        pagination: { total: number };
      }>(`/payments?${params.toString()}`);

      setPayments(response.data || []);
    } catch (err) {
      console.error('Error fetching payments:', err);
      setError('Failed to load payments');
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  const fetchUnpaidInvoices = async () => {
    try {
      const response = await api.get<{
        data: Array<{
          id: string;
          invoiceNumber: string;
          customer: { name: string };
          totalAmount: string;
          paidAmount: string;
          status: string;
        }>;
      }>('/invoices?status=ISSUED&limit=100');

      const invoices = (response.data || []).map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer.name,
        totalAmount: inv.totalAmount,
        paidAmount: inv.paidAmount || '0',
        remainingBalance: (parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount || '0')).toFixed(2),
        status: inv.status,
      }));

      setUnpaidInvoices(invoices.filter((inv) => parseFloat(inv.remainingBalance) > 0));
    } catch (err) {
      console.error('Error fetching unpaid invoices:', err);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const formatCurrency = (value: string | number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(typeof value === 'string' ? parseFloat(value) : value);
  };

  const handleOpenCreateModal = () => {
    fetchUnpaidInvoices();
    setFormData({
      invoiceId: '',
      amount: '',
      currency: 'USD',
      paymentDate: new Date().toISOString().split('T')[0],
      reference: '',
      method: '',
      notes: '',
    });
    setSelectedInvoice(null);
    setIsCreateModalOpen(true);
  };

  const handleInvoiceSelect = (invoiceId: string) => {
    const invoice = unpaidInvoices.find((inv) => inv.id === invoiceId);
    setSelectedInvoice(invoice || null);
    setFormData((prev) => ({
      ...prev,
      invoiceId,
      amount: invoice?.remainingBalance || '',
    }));
  };

  const handleCreatePayment = async () => {
    if (!formData.invoiceId || !formData.amount || !formData.paymentDate) {
      setError('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await api.post<{ invoiceFullyPaid: boolean }>('/payments', {
        invoiceId: formData.invoiceId,
        amount: parseFloat(formData.amount),
        currency: formData.currency,
        paymentDate: formData.paymentDate,
        reference: formData.reference || undefined,
        method: formData.method || undefined,
        notes: formData.notes || undefined,
      });

      setIsCreateModalOpen(false);
      setSuccessMessage(
        response.invoiceFullyPaid
          ? 'Payment recorded successfully. Invoice is now marked as PAID.'
          : 'Payment recorded successfully.'
      );
      fetchPayments();
    } catch (err) {
      console.error('Error creating payment:', err);
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns: ColumnDef<Payment>[] = useMemo(
    () => [
      {
        accessorKey: 'paymentDate',
        header: 'Payment Date',
        cell: ({ row }) => (
          <span className="font-medium">
            {new Date(row.original.paymentDate).toLocaleDateString()}
          </span>
        ),
      },
      {
        accessorKey: 'invoiceNumber',
        header: 'Invoice',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {row.original.invoiceNumber}
          </Badge>
        ),
      },
      {
        accessorKey: 'customer',
        header: 'Customer',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.customer.name}</span>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => (
          <span className="font-medium text-green-600 dark:text-green-400">
            {formatCurrency(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: 'method',
        header: 'Method',
        cell: ({ row }) =>
          row.original.method ? (
            <Badge variant="secondary">{row.original.method}</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        accessorKey: 'reference',
        header: 'Reference',
        cell: ({ row }) =>
          row.original.reference ? (
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {row.original.reference}
            </code>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        accessorKey: 'recordedBy',
        header: 'Recorded By',
        cell: ({ row }) => (
          <div className="text-sm">
            <p>
              {row.original.recordedBy.firstName} {row.original.recordedBy.lastName}
            </p>
            <p className="text-muted-foreground text-xs">
              {new Date(row.original.createdAt).toLocaleString()}
            </p>
          </div>
        ),
      },
    ],
    []
  );

  // Calculate summary stats
  const summary = useMemo(() => {
    const total = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    return {
      count: payments.length,
      totalAmount: total,
    };
  }, [payments]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track and record invoice payments
          </p>
        </div>
        <Button onClick={handleOpenCreateModal}>
          <Plus className="h-4 w-4 mr-2" />
          Record Payment
        </Button>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Payments</p>
              <p className="text-2xl font-bold">{summary.count}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Amount</p>
              <p className="text-2xl font-bold">{formatCurrency(summary.totalAmount)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={fetchPayments} variant="secondary" className="w-full">
              Apply Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Payments Table */}
      <Card>
        <DataTable
          data={payments}
          columns={columns}
          isLoading={isLoading}
          emptyMessage="No payments recorded"
          pageSize={20}
        />
      </Card>

      {/* Create Payment Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Record Payment"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <Label>Invoice *</Label>
            <Select value={formData.invoiceId} onValueChange={handleInvoiceSelect}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select unpaid invoice" />
              </SelectTrigger>
              <SelectContent>
                {unpaidInvoices.map((invoice) => (
                  <SelectItem key={invoice.id} value={invoice.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{invoice.invoiceNumber}</span>
                      <span className="text-muted-foreground">-</span>
                      <span>{invoice.customerName}</span>
                      <span className="text-muted-foreground">
                        (Balance: {formatCurrency(invoice.remainingBalance)})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedInvoice && (
            <div className="bg-muted/50 p-3 rounded-lg text-sm space-y-1">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{selectedInvoice.invoiceNumber}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-muted-foreground">
                <div>
                  <p className="text-xs">Total</p>
                  <p className="font-medium text-foreground">
                    {formatCurrency(selectedInvoice.totalAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs">Paid</p>
                  <p className="font-medium text-foreground">
                    {formatCurrency(selectedInvoice.paidAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs">Balance</p>
                  <p className="font-medium text-green-600 dark:text-green-400">
                    {formatCurrency(selectedInvoice.remainingBalance)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <Select
                value={formData.currency}
                onValueChange={(v) => setFormData({ ...formData, currency: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Payment Date *</Label>
              <Input
                type="date"
                value={formData.paymentDate}
                onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select
                value={formData.method}
                onValueChange={(v) => setFormData({ ...formData, method: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                  <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                  <SelectItem value="CHECK">Check</SelectItem>
                  <SelectItem value="WIRE">Wire Transfer</SelectItem>
                  <SelectItem value="ACH">ACH</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Reference / Transaction ID</Label>
            <Input
              value={formData.reference}
              onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
              placeholder="e.g., TXN-123456"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Optional notes about this payment"
              className="mt-1"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleCreatePayment} disabled={isSubmitting}>
              {isSubmitting ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
