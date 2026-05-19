'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { Credit, SkuGroup, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import { Plus, Eye, Check, X } from 'lucide-react';

const CREDIT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'DISCOUNT', label: 'Discount' },
  { value: 'SUSTAINED_USAGE_DISCOUNT', label: 'Sustained Usage Discount' },
  { value: 'COMMITTED_USAGE_DISCOUNT', label: 'Committed Usage Discount' },
  { value: 'COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE', label: 'Committed Usage Discount ($ base)' },
  { value: 'PROMOTION', label: 'Promotion' },
  { value: 'SUBSCRIPTION_BENEFIT', label: 'Subscription Benefit' },
];

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

interface FormData {
  types: string[];
  totalAmount: string;
  description: string;
  validFrom: string;
  validTo: string;
  matchSkuId: string;
  matchSkuGroupId: string;
  matchProjectId: string;
}

const emptyForm = (): FormData => {
  const today = new Date();
  const nextYear = new Date(today);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  return {
    types: ['DISCOUNT'],
    totalAmount: '',
    description: '',
    validFrom: today.toISOString().split('T')[0],
    validTo: nextYear.toISOString().split('T')[0],
    matchSkuId: '',
    matchSkuGroupId: '',
    matchProjectId: '',
  };
};

const labelForType = (v: string) => CREDIT_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v;

export function CustomerCreditsTab({ customerId }: CustomerCreditsTabProps) {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [skuGroups, setSkuGroups] = useState<SkuGroup[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<CreditLedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [, setSelectedCreditId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);

  const [formData, setFormData] = useState<FormData>(emptyForm());
  const [typeSearchQuery, setTypeSearchQuery] = useState('');
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);

  const filteredTypeOptions = useMemo(() => {
    const q = typeSearchQuery.trim().toLowerCase();
    if (!q) return CREDIT_TYPE_OPTIONS;
    return CREDIT_TYPE_OPTIONS.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [typeSearchQuery]);

  const toggleType = (value: string) => {
    setFormData((f) => ({
      ...f,
      types: f.types.includes(value)
        ? f.types.filter((t) => t !== value)
        : [...f.types, value],
    }));
  };

  const fetchCredits = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [creditsRes, skuGroupsRes] = await Promise.all([
        api.get<{ data: Credit[] }>(`/customers/${customerId}/credits`),
        api.get<PaginatedResponse<SkuGroup>>('/sku-groups?limit=500'),
      ]);
      setCredits(creditsRes.data || []);
      setSkuGroups(skuGroupsRes.data || []);
    } catch (err) {
      console.error('Error fetching credits:', err);
      setError('Failed to load credits');
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => { fetchCredits(); }, [fetchCredits]);

  const handleCreate = () => {
    setFormData(emptyForm());
    setTypeSearchQuery('');
    setTypeDropdownOpen(false);
    setShowCreateModal(true);
  };

  const handleSubmit = async () => {
    if (formData.types.length === 0) {
      setError('At least one type is required');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await api.post(`/customers/${customerId}/credits`, {
        types: formData.types,
        totalAmount: parseFloat(formData.totalAmount),
        description: formData.description || undefined,
        validFrom: formData.validFrom,
        validTo: formData.validTo,
        matchSkuId: formData.matchSkuId.trim() || null,
        matchSkuGroupId: formData.matchSkuGroupId || null,
        matchProjectId: formData.matchProjectId.trim() || null,
      });
      setShowCreateModal(false);
      fetchCredits();
    } catch (err) {
      console.error('Error creating credit:', err);
      setError(err instanceof Error ? err.message : 'Failed to create credit');
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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  };

  const columns: ColumnDef<Credit>[] = useMemo(
    () => [
      {
        accessorKey: 'types',
        header: 'Types',
        cell: ({ row }) => {
          const types = row.original.types ?? [];
          if (types.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {types.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">{labelForType(t)}</Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: 'scope',
        header: 'Scope',
        cell: ({ row }) => {
          const c = row.original;
          const parts: string[] = [];
          if (c.matchSkuId) parts.push(`SKU ${c.matchSkuId}`);
          if (c.matchSkuGroup) parts.push(`Group ${c.matchSkuGroup.code}`);
          if (c.matchProjectId) parts.push(`Project ${c.matchProjectId}`);
          if (parts.length === 0) {
            return <Badge variant="outline" className="text-xs text-muted-foreground">Unrestricted</Badge>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              {parts.map((p, i) => (
                <Badge key={i} variant="secondary" className="font-mono text-xs">{p}</Badge>
              ))}
            </div>
          );
        },
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
          {/* Types multi-select with search */}
          <div className="space-y-2">
            <Label>Types * <span className="text-xs text-muted-foreground font-normal">(multi-select)</span></Label>
            <div className="flex flex-wrap gap-1 min-h-[2rem] rounded-md border bg-background px-2 py-1.5">
              {formData.types.length === 0 ? (
                <span className="text-sm text-muted-foreground self-center">Select at least one…</span>
              ) : (
                formData.types.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1">
                    {labelForType(t)}
                    <button
                      type="button"
                      onClick={() => toggleType(t)}
                      className="hover:text-destructive ml-0.5"
                      aria-label={`Remove ${t}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
            <div className="relative">
              <Input
                type="text"
                placeholder="Search types (e.g. CUD, promotion, sustained)..."
                value={typeSearchQuery}
                onChange={(e) => { setTypeSearchQuery(e.target.value); setTypeDropdownOpen(true); }}
                onFocus={() => setTypeDropdownOpen(true)}
                onBlur={() => setTimeout(() => setTypeDropdownOpen(false), 150)}
              />
              {typeDropdownOpen && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
                  {filteredTypeOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matching types</div>
                  ) : (
                    filteredTypeOptions.map((opt) => {
                      const selected = formData.types.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); toggleType(opt.value); }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-muted/50 ${selected ? 'bg-primary/5' : ''}`}
                        >
                          <Check className={`h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                          <span className="flex-1">{opt.label}</span>
                          <span className="text-xs text-muted-foreground font-mono">{opt.value}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
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

          {/* Optional scope filters */}
          <div className="rounded-md border p-3 space-y-3">
            <div>
              <div className="text-sm font-medium">Scope filters (optional)</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Leave all blank to apply to this customer&apos;s entire invoice. Set any combination to
                narrow scope (AND logic).
              </p>
            </div>
            <div>
              <Label htmlFor="matchSkuGroupId">SKU Group</Label>
              <Select
                value={formData.matchSkuGroupId || 'none'}
                onValueChange={(v) => setFormData({ ...formData, matchSkuGroupId: v === 'none' ? '' : v })}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Any SKU group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Any SKU group</SelectItem>
                  {skuGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.code}{g.name && g.name !== g.code ? ` (${g.name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="matchSkuId">SKU ID</Label>
                <Input
                  id="matchSkuId"
                  value={formData.matchSkuId}
                  onChange={(e) => setFormData({ ...formData, matchSkuId: e.target.value })}
                  placeholder="e.g. A5A6-3EDC-7F3C"
                  className="mt-1 font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="matchProjectId">Project ID</Label>
                <Input
                  id="matchProjectId"
                  value={formData.matchProjectId}
                  onChange={(e) => setFormData({ ...formData, matchProjectId: e.target.value })}
                  placeholder="e.g. my-prod-project"
                  className="mt-1 font-mono text-xs"
                />
              </div>
            </div>
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
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!formData.totalAmount || isSaving || formData.types.length === 0}>
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
                    <td className="px-4 py-2">{new Date(entry.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2">
                      <Badge variant={entry.type === 'ALLOCATION' ? 'default' : 'secondary'}>
                        {entry.type}
                      </Badge>
                    </td>
                    <td className={`px-4 py-2 text-right ${parseFloat(entry.amount) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {parseFloat(entry.amount) >= 0 ? '+' : ''}{formatCurrency(entry.amount)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{formatCurrency(entry.balanceAfter)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{entry.description || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={() => setShowLedgerModal(false)}>Close</Button>
        </div>
      </Modal>
    </div>
  );
}
