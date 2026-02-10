'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { Credit, Customer, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';

interface CreditFormData {
  customerId: string;
  type: string;
  totalAmount: string;
  description: string;
  validFrom: string;
  validTo: string;
}

export default function CreditsPage() {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<CreditFormData>({
    customerId: '',
    type: 'PROMOTIONAL',
    totalAmount: '',
    description: '',
    validFrom: '',
    validTo: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const fetchCredits = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [creditsRes, customersRes] = await Promise.all([
        api.get<PaginatedResponse<Credit>>('/credits'),
        api.get<PaginatedResponse<Customer>>('/customers'),
      ]);
      setCredits(creditsRes.data || []);
      setCustomers(customersRes.data || []);
    } catch (err) {
      console.error('Error fetching credits:', err);
      setError('Failed to load credits');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  const getCustomerName = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || customerId;
  };

  const columns: ColumnDef<Credit>[] = useMemo(
    () => [
      {
        accessorKey: 'customerId',
        header: 'Customer',
        cell: ({ row }) => (
          <span className="font-medium">{getCustomerName(row.original.customerId)}</span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.type}</Badge>
        ),
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total',
        cell: ({ row }) => formatCurrency(row.original.totalAmount),
      },
      {
        accessorKey: 'remainingAmount',
        header: 'Remaining',
        cell: ({ row }) => (
          <span className={parseFloat(row.original.remainingAmount) > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
            {formatCurrency(row.original.remainingAmount)}
          </span>
        ),
      },
      {
        accessorKey: 'validFrom',
        header: 'Valid From',
        cell: ({ row }) => new Date(row.original.validFrom).toLocaleDateString(),
      },
      {
        accessorKey: 'validTo',
        header: 'Valid To',
        cell: ({ row }) => new Date(row.original.validTo).toLocaleDateString(),
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
    ],
    [customers]
  );

  const handleCreate = () => {
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    setFormData({
      customerId: '',
      type: 'PROMOTIONAL',
      totalAmount: '',
      description: '',
      validFrom: today.toISOString().split('T')[0],
      validTo: nextYear.toISOString().split('T')[0],
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await api.post('/credits', {
        ...formData,
        totalAmount: parseFloat(formData.totalAmount),
      });
      setShowModal(false);
      fetchCredits();
    } catch (err) {
      console.error('Error creating credit:', err);
      setError('Failed to create credit');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Credits</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage customer credits and discounts</p>
        </div>
        <Can resource="credits" action="create">
          <Button onClick={handleCreate}>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Credit
          </Button>
        </Can>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <DataTable
          data={credits}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder="Search credits..."
          emptyMessage="No credits found"
          pageSize={20}
        />
      </Card>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="New Credit"
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-4"
        >
          <div>
            <Label>Customer *</Label>
            <Select
              value={formData.customerId}
              onValueChange={(value) => setFormData({ ...formData, customerId: value })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Type *</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROMOTIONAL">Promotional</SelectItem>
                  <SelectItem value="COMMITMENT">Commitment</SelectItem>
                  <SelectItem value="GOODWILL">Goodwill</SelectItem>
                  <SelectItem value="REFUND">Refund</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="totalAmount">Amount *</Label>
              <Input
                id="totalAmount"
                type="number"
                value={formData.totalAmount}
                onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
                required
                min="0"
                step="0.01"
                placeholder="1000.00"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              placeholder="Credit for promotional campaign..."
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="validFrom">Valid From *</Label>
              <Input
                id="validFrom"
                type="date"
                value={formData.validFrom}
                onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="validTo">Valid To *</Label>
              <Input
                id="validTo"
                type="date"
                value={formData.validTo}
                onChange={(e) => setFormData({ ...formData, validTo: e.target.value })}
                required
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function formatCurrency(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}
