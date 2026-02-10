'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { Credit } from '@/lib/client/types';
import { DataTable, Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import { Plus, Eye } from 'lucide-react';

interface CreditLedgerEntry {
  id: string;
  creditId: string;
  type: 'ALLOCATION' | 'USAGE' | 'ADJUSTMENT' | 'EXPIRY';
  amount: string;
  balanceAfter: string;
  description: string | null;
  invoiceId: string | null;
  createdAt: string;
}

interface CustomerCreditsTabProps {
  customerId: string;
}

const CREDIT_TYPES = [
  { value: 'PROMOTIONAL', label: 'Promotional' },
  { value: 'COMMITMENT', label: 'Commitment' },
  { value: 'GOODWILL', label: 'Goodwill' },
  { value: 'REFUND', label: 'Refund' },
];

export function CustomerCreditsTab({ customerId }: CustomerCreditsTabProps) {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<CreditLedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);

  const [formData, setFormData] = useState({
    type: 'PROMOTIONAL',
    totalAmount: '',
    description: '',
    validFrom: '',
    validTo: '',
  });

  const fetchCredits = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<{ data: Credit[] }>(`/customers/${customerId}/credits`);
      setCredits(response.data || []);
    } catch (err) {
      console.error('Error fetching credits:', err);
      setError('Failed to load credits');
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  const handleCreate = () => {
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    setFormData({
      type: 'PROMOTIONAL',
      totalAmount: '',
      description: '',
      validFrom: today.toISOString().split('T')[0],
      validTo: nextYear.toISOString().split('T')[0],
    });
    setShowCreateModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await api.post(`/customers/${customerId}/credits`, {
        ...formData,
        totalAmount: parseFloat(formData.totalAmount),
      });
      setShowCreateModal(false);
      fetchCredits();
    } catch (err) {
      console.error('Error creating credit:', err);
      setError('Failed to create credit');
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewLedger = async (creditId: string) => {
    setSelectedCreditId(creditId);
    setIsLoadingLedger(true);
    setShowLedgerModal(true);

    try {
      const response = await api.get<{ data: CreditLedgerEntry[] }>(`/credits/${creditId}/ledger`);
      setLedgerEntries(response.data || []);
    } catch (err) {
      console.error('Error fetching ledger:', err);
      setLedgerEntries([]);
    } finally {
      setIsLoadingLedger(false);
    }
  };

  const formatCurrency = (value: string | number): string => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);
  };

  const columns: ColumnDef<Credit>[] = useMemo(
    () => [
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
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" onClick={() => handleViewLedger(row.original.id)}>
            <Eye className="h-4 w-4 mr-1" />
            Ledger
          </Button>
        ),
      },
    ],
    []
  );

  // Calculate totals
  const totals = useMemo(() => {
    const total = credits.reduce((sum, c) => sum + parseFloat(c.totalAmount), 0);
    const remaining = credits.reduce((sum, c) => sum + parseFloat(c.remainingAmount), 0);
    const used = total - remaining;
    return { total, remaining, used };
  }, [credits]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Credits</p>
          <p className="text-2xl font-bold">{formatCurrency(totals.total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Used</p>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{formatCurrency(totals.used)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Remaining</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(totals.remaining)}</p>
        </Card>
      </div>

      {/* Credits Table */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Credits</h3>
          <Can resource="credits" action="create">
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Credit
            </Button>
          </Can>
        </div>

        {error && (
          <Alert variant="error" className="mb-4" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <DataTable
          data={credits}
          columns={columns}
          isLoading={isLoading}
          emptyMessage="No credits for this customer"
          pageSize={10}
        />
      </Card>

      {/* Create Credit Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="New Credit"
        size="md"
      >
        <div className="space-y-4">
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
                  {CREDIT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
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
                placeholder="1000.00"
                min="0"
                step="0.01"
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
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formData.totalAmount || isSaving}>
              {isSaving ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Ledger Modal */}
      <Modal
        isOpen={showLedgerModal}
        onClose={() => setShowLedgerModal(false)}
        title="Credit Ledger"
        size="lg"
      >
        {isLoadingLedger ? (
          <div className="text-center py-8 text-muted-foreground">Loading ledger...</div>
        ) : ledgerEntries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No ledger entries</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-4 py-2">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={entry.type === 'ALLOCATION' ? 'default' : 'secondary'}>
                        {entry.type}
                      </Badge>
                    </td>
                    <td className={`px-4 py-2 text-right ${parseFloat(entry.amount) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {parseFloat(entry.amount) >= 0 ? '+' : ''}{formatCurrency(entry.amount)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      {formatCurrency(entry.balanceAfter)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {entry.description || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={() => setShowLedgerModal(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}
