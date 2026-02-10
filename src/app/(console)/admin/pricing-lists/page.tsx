'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { PricingList, Customer, PaginatedResponse } from '@/lib/client/types';
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
}

export default function PricingListsPage() {
  const router = useRouter();
  const t = useTranslations('pricingLists');
  const tc = useTranslations('common');
  const [pricingLists, setPricingLists] = useState<PricingList[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
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
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [pricingResponse, customersResponse] = await Promise.all([
        api.get<PaginatedResponse<PricingList>>('/pricing-lists'),
        api.get<PaginatedResponse<Customer>>('/customers'),
      ]);
      setPricingLists(pricingResponse.data || []);
      setCustomers(customersResponse.data || []);
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
    [t, tc]
  );

  const handleEdit = (list: PricingList) => {
    setEditingList(list);
    setFormData({
      name: list.name,
      customerId: list.customer.id,
      status: list.status,
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
        });
      } else {
        await api.post('/pricing-lists', {
          name: formData.name,
          customerId: formData.customerId,
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
