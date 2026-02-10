'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { SkuGroup, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Can } from '@/components/auth';
import { ExternalLink } from 'lucide-react';

export default function SkuGroupsPage() {
  const router = useRouter();
  const t = useTranslations('productGroups');
  const tc = useTranslations('common');
  const [skuGroups, setSkuGroups] = useState<SkuGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ code: '', name: '', description: '' });
  const [isSaving, setIsSaving] = useState(false);

  const fetchSkuGroups = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<PaginatedResponse<SkuGroup>>('/sku-groups');
      setSkuGroups(response.data || []);
    } catch (err) {
      console.error('Error fetching SKU groups:', err);
      setError('Failed to load SKU groups');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkuGroups();
  }, [fetchSkuGroups]);

  const columns: ColumnDef<SkuGroup>[] = useMemo(
    () => [
      {
        accessorKey: 'code',
        header: t('code'),
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono">
            {row.original.code}
          </Badge>
        ),
      },
      {
        accessorKey: 'name',
        header: t('name'),
      },
      {
        accessorKey: 'description',
        header: t('description'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.description || '-'}
          </span>
        ),
      },
      {
        accessorKey: 'skuCount',
        header: t('billingItems'),
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.skuCount} {t('itemsUnit')}</Badge>
        ),
      },
      {
        accessorKey: 'ruleCount',
        header: t('pricingRules'),
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.ruleCount} {t('rulesUnit')}</Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/admin/sku-groups/${row.original.id}`)}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            {t('actions.manageItems')}
          </Button>
        ),
      },
    ],
    [router, t]
  );

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      await api.post('/sku-groups', formData);
      setShowModal(false);
      setFormData({ code: '', name: '', description: '' });
      fetchSkuGroups();
    } catch (err) {
      console.error('Error creating SKU group:', err);
      setError('Failed to create SKU group');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('subtitle')}
          </p>
        </div>
        <Can resource="sku_groups" action="create">
          <Button onClick={() => setShowModal(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
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
          data={skuGroups}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('searchPlaceholder')}
          emptyMessage={t('noGroups')}
          pageSize={20}
        />
      </Card>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={t('modal.createTitle')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('modal.createDescription')}
          </p>
          <div>
            <Label htmlFor="code">{t('groupCode')} *</Label>
            <Input
              id="code"
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              required
              className="mt-1 font-mono"
              placeholder={t('placeholders.code')}
            />
            <p className="text-xs text-muted-foreground mt-1">{t('hints.code')}</p>
          </div>
          <div>
            <Label htmlFor="name">{t('displayName')} *</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="mt-1"
              placeholder={t('placeholders.name')}
            />
            <p className="text-xs text-muted-foreground mt-1">{t('hints.name')}</p>
          </div>
          <div>
            <Label htmlFor="description">{tc('description')} ({tc('optional')})</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="mt-1"
              placeholder={t('placeholders.description')}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleCreate} isLoading={isSaving}>
              {tc('create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
