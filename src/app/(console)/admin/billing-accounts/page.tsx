'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { BillingAccount, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Alert } from '@/components/ui';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Modal } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import { Plus, ExternalLink } from 'lucide-react';

interface FormData {
  billingAccountId: string;
  name: string;
}

export default function BillingAccountsPage() {
  const router = useRouter();
  const t = useTranslations('billingAccounts');
  const tc = useTranslations('common');
  const [accounts, setAccounts] = useState<BillingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    billingAccountId: '',
    name: '',
  });

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<PaginatedResponse<BillingAccount>>('/billing-accounts');
      setAccounts(response.data || []);
    } catch (err) {
      console.error('Error fetching billing accounts:', err);
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleCreate = () => {
    setFormData({ billingAccountId: '', name: '' });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await api.post('/billing-accounts', {
        billingAccountId: formData.billingAccountId,
        name: formData.name || null,
      });
      setShowModal(false);
      fetchAccounts();
    } catch (err) {
      console.error('Error creating billing account:', err);
      setError(err instanceof Error ? err.message : t('createFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="default">{tc('active')}</Badge>;
      case 'SUSPENDED':
        return <Badge variant="destructive">{tc('suspended')}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const columns: ColumnDef<BillingAccount>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name || row.original.billingAccountId}</div>
            <div className="text-xs text-muted-foreground">{row.original.billingAccountId}</div>
          </div>
        ),
      },
      {
        accessorKey: 'projectCount',
        header: t('projectCount'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.projectCount}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: tc('status'),
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/admin/billing-accounts/${row.original.id}`)}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            {tc('view')}
          </Button>
        ),
      },
    ],
    [t, tc, router]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
        <Can resource="billing_accounts" action="create">
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
          data={accounts}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('searchPlaceholder')}
          emptyMessage={t('noAccounts')}
          pageSize={20}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={t('modal.createTitle')}
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="billingAccountId">{t('billingAccountId')} *</Label>
            <Input
              id="billingAccountId"
              type="text"
              value={formData.billingAccountId}
              onChange={(e) => setFormData({ ...formData, billingAccountId: e.target.value })}
              placeholder={t('placeholders.billingAccountId')}
              required
            />
            <p className="text-xs text-muted-foreground">
              {t('hints.billingAccountId')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t('name')}</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('placeholders.name')}
            />
            <p className="text-xs text-muted-foreground">
              {t('hints.name')}
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving || !formData.billingAccountId}>
              {tc('create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
