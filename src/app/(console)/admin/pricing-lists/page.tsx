'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { fetchAllPages } from '@/lib/client/pagination';
import { PricingList, Customer } from '@/lib/client/types';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import { Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';

interface PricingListFormData {
  name: string;
  customerId: string;
  status: string;
  priceBasis: 'STANDARD' | 'COST';
  billingAccountIds: string[];
  defaultDiscountPercent: string; // for create only — sets the default rule
}

interface BillingAccountOption {
  id: string;
  billingAccountId: string;
  name: string | null;
}

export default function PricingListsPage() {
  const router = useRouter();
  const t = useTranslations('pricingLists');
  const tc = useTranslations('common');
  const [pricingLists, setPricingLists] = useState<PricingList[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [billingAccounts, setBillingAccounts] = useState<BillingAccountOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingList, setEditingList] = useState<PricingList | null>(null);
  const [deletingList, setDeletingList] = useState<PricingList | null>(null);
  const [formData, setFormData] = useState<PricingListFormData>({
    name: '',
    customerId: '',
    status: 'ACTIVE',
    priceBasis: 'STANDARD',
    billingAccountIds: [],
    defaultDiscountPercent: '0',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [pricingResponse, customersResponse, billingAccountsResponse] = await Promise.all([
        fetchAllPages<PricingList>('/pricing-lists'),
        fetchAllPages<Customer>('/customers'),
        fetchAllPages<BillingAccountOption>('/billing-accounts'),
      ]);
      setPricingLists(pricingResponse);
      setCustomers(customersResponse);
      setBillingAccounts(billingAccountsResponse);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnDef<PricingList>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'customer',
        header: tc('customer'),
        cell: ({ row }) => (
          <div>
            <div>{row.original.customer.name}</div>
            {row.original.customer.externalId && (
              <div className="text-xs text-muted-foreground">
                {row.original.customer.externalId}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'priceBasis',
        header: t('priceBasis'),
        cell: ({ row }) => (
          <Badge variant="outline">
            {t(`basis.${row.original.priceBasis.toLowerCase()}`)}
          </Badge>
        ),
      },
      {
        accessorKey: 'billingAccountIds',
        header: t('billingIds'),
        cell: ({ row }) => row.original.billingAccountIds.length === 0 ? (
          <Badge variant="secondary">{t('allBillingIds')}</Badge>
        ) : (
          <div className="flex max-w-[280px] flex-wrap gap-1">
            {row.original.billingAccountIds.slice(0, 2).map((id) => (
              <Badge key={id} variant="outline" className="font-mono text-xs">{id}</Badge>
            ))}
            {row.original.billingAccountIds.length > 2 && (
              <Badge variant="secondary">+{row.original.billingAccountIds.length - 2}</Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'ruleCount',
        header: t('rules'),
        cell: ({ row }) => (
          <Badge variant="secondary">
            {row.original.ruleCount} {t('rulesCount')}
          </Badge>
        ),
      },
      {
        accessorKey: 'isActive',
        header: tc('status'),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
            {row.original.isActive ? tc('active') : tc('inactive')}
          </Badge>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: tc('createdAt'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/admin/pricing-lists/${row.original.id}`)}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              {t('actions.manageRules')}
            </Button>
            <Can resource="customers" action="update">
              <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
                <Pencil className="h-4 w-4 mr-1" />
                {tc('edit')}
              </Button>
            </Can>
            <Can resource="customers" action="delete">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDeleteClick(row.original)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Can>
          </div>
        ),
      },
    ],
    [router, t, tc]
  );

  const handleEdit = (list: PricingList) => {
    setEditingList(list);
    setFormData({
      name: list.name,
      customerId: list.customer.id,
      status: list.status,
      priceBasis: list.priceBasis,
      billingAccountIds: list.billingAccountIds,
      defaultDiscountPercent: '0',
    });
    setShowModal(true);
  };

  const handleDeleteClick = (list: PricingList) => {
    setDeletingList(list);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!deletingList) return;
    setIsDeleting(true);
    setError(null);

    try {
      await api.delete(`/pricing-lists/${deletingList.id}`);
      setShowDeleteModal(false);
      setDeletingList(null);
      fetchData();
    } catch (err) {
      console.error('Error deleting pricing list:', err);
      setError(err instanceof Error ? err.message : t('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreate = () => {
    setEditingList(null);
    setFormData({
      name: '',
      customerId: '',
      status: 'ACTIVE',
      priceBasis: 'STANDARD',
      billingAccountIds: [],
      defaultDiscountPercent: '0',
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    setError(null);

    try {
      if (editingList) {
        await api.put(`/pricing-lists/${editingList.id}`, {
          name: formData.name,
          status: formData.status,
          priceBasis: formData.priceBasis,
          billingAccountIds: formData.billingAccountIds,
        });
      } else {
        await api.post('/pricing-lists', {
          name: formData.name,
          customerId: formData.customerId,
          priceBasis: formData.priceBasis,
          billingAccountIds: formData.billingAccountIds,
          defaultDiscountPercent: parseFloat(formData.defaultDiscountPercent) || 0,
        });
      }
      setShowModal(false);
      setEditingList(null);
      fetchData();
    } catch (err) {
      console.error('Error saving pricing list:', err);
      setError(err instanceof Error ? err.message : editingList ? t('updateFailed') : t('createFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
        <Can resource="customers" action="update">
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t('actions.create')}
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
          data={pricingLists}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('searchPlaceholder')}
          emptyMessage={t('noLists')}
          pageSize={20}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingList(null); }}
        title={editingList ? t('modal.editTitle') : t('modal.createTitle')}
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-4"
        >
          {!editingList && (
            <div className="space-y-2">
              <Label htmlFor="customerId">{tc('customer')} *</Label>
              <Select
                value={formData.customerId}
                onValueChange={(value) => setFormData({ ...formData, customerId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tc('selectCustomer')} />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                      {customer.externalId && ` (${customer.externalId})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {editingList && (
            <div className="space-y-2">
              <Label>{tc('customer')}</Label>
              <p className="text-sm text-muted-foreground">
                {editingList.customer.name}
                {editingList.customer.externalId && ` (${editingList.customer.externalId})`}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">{t('name')} *</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder={t('placeholders.name')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="priceBasis">{t('priceBasis')} *</Label>
            <Select
              value={formData.priceBasis}
              onValueChange={(value: 'STANDARD' | 'COST') => setFormData({ ...formData, priceBasis: value })}
            >
              <SelectTrigger id="priceBasis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDARD">{t('basis.standard')}</SelectItem>
                <SelectItem value="COST">{t('basis.cost')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`basisHints.${formData.priceBasis.toLowerCase()}`)}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t('billingIds')}</Label>
            <div className="rounded-md border">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, billingAccountIds: [] })}
                className={`flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm transition-colors ${
                  formData.billingAccountIds.length === 0 ? 'bg-primary/5 text-primary' : 'hover:bg-muted/50'
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${
                  formData.billingAccountIds.length === 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                }`}>
                  {formData.billingAccountIds.length === 0 ? '✓' : ''}
                </span>
                <span>
                  <span className="block font-medium">{t('allBillingIds')}</span>
                  <span className="block text-xs text-muted-foreground">{t('allBillingIdsHint')}</span>
                </span>
              </button>
              <div className="max-h-48 overflow-y-auto p-1">
                {billingAccounts.map((account) => {
                  const selected = formData.billingAccountIds.includes(account.billingAccountId);
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        billingAccountIds: selected
                          ? formData.billingAccountIds.filter((id) => id !== account.billingAccountId)
                          : [...formData.billingAccountIds, account.billingAccountId],
                      })}
                      className={`flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm hover:bg-muted/50 ${selected ? 'bg-muted/40' : ''}`}
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                      }`}>
                        {selected ? '✓' : ''}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{account.name || account.billingAccountId}</span>
                        {account.name && (
                          <span className="block font-mono text-xs text-muted-foreground">{account.billingAccountId}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('billingIdsHint')}</p>
          </div>

          {!editingList && (
            <div className="space-y-2">
              <Label htmlFor="defaultDiscountPercent">{t('defaultDiscountPercent')} *</Label>
              <div className="relative">
                <Input
                  id="defaultDiscountPercent"
                  type="number"
                  value={formData.defaultDiscountPercent}
                  onChange={(e) => setFormData({ ...formData, defaultDiscountPercent: e.target.value })}
                  min={0}
                  max={100}
                  step={0.1}
                  required
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('defaultDiscountHint')}</p>
            </div>
          )}

          {editingList && (
            <div className="space-y-2">
              <Label htmlFor="status">{tc('status')}</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">{tc('active')}</SelectItem>
                  <SelectItem value="INACTIVE">{tc('inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditingList(null); }}>
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || (!editingList && !formData.customerId) || !formData.name}
            >
              {editingList ? tc('save') : tc('create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeletingList(null); }}
        title={t('modal.deleteTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t('modal.deleteConfirm', { name: deletingList?.name || '' })}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setDeletingList(null); }}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={isDeleting}>
              {tc('delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
