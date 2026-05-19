'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { Customer, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Alert } from '@/components/ui';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Modal } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import { Plus, Pencil, Trash2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Operator {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface ProjectBillingConfig {
  id: string;
  projectId: string;
  billable: boolean;
  customer: { id: string; name: string; externalId: string | null };
  createdBy: Operator | null;
  updatedBy: Operator | null;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  projectId: string;
  customerId: string;
  billable: boolean;
}

const emptyForm = (): FormData => ({ projectId: '', customerId: '', billable: true });

function operatorLabel(op: Operator | null): string {
  if (!op) return '—';
  const full = `${op.firstName ?? ''} ${op.lastName ?? ''}`.trim();
  return full || op.email;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectBillingConfigsPage() {
  const t = useTranslations('projectBillingConfigs');
  const tc = useTranslations('common');

  const [configs, setConfigs] = useState<ProjectBillingConfig[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ProjectBillingConfig | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState<ProjectBillingConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [configsRes, customersRes] = await Promise.all([
        api.get<PaginatedResponse<ProjectBillingConfig>>('/project-billing-configs?limit=200'),
        api.get<PaginatedResponse<Customer>>('/customers?limit=200'),
      ]);
      setConfigs(configsRes.data || []);
      setCustomers(customersRes.data || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -------------------------------------------------------------------------

  const columns: ColumnDef<ProjectBillingConfig>[] = useMemo(
    () => [
      {
        accessorKey: 'projectId',
        header: t('projectId'),
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono text-xs">
            {row.original.projectId}
          </Badge>
        ),
      },
      {
        accessorKey: 'customer',
        header: t('customer'),
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.customer.name}</div>
            {row.original.customer.externalId && (
              <div className="text-xs text-muted-foreground">{row.original.customer.externalId}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'billable',
        header: t('billable'),
        cell: ({ row }) =>
          row.original.billable ? (
            <Badge variant="default">{t('billableYes')}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">{t('billableNo')}</Badge>
          ),
      },
      {
        accessorKey: 'createdAt',
        header: t('createdAt'),
        cell: ({ row }) => (
          <div className="text-xs">
            <div>{new Date(row.original.createdAt).toLocaleString()}</div>
            <div className="text-muted-foreground">
              {t('by')}: {operatorLabel(row.original.createdBy)}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('updatedAt'),
        cell: ({ row }) => (
          <div className="text-xs">
            <div>{new Date(row.original.updatedAt).toLocaleString()}</div>
            <div className="text-muted-foreground">
              {t('by')}: {operatorLabel(row.original.updatedBy)}
            </div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Can resource="project_billing_configs" action="update">
              <Button variant="ghost" size="sm" onClick={() => openEdit(row.original)}>
                <Pencil className="h-4 w-4" />
              </Button>
            </Can>
            <Can resource="project_billing_configs" action="delete">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => openDelete(row.original)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Can>
          </div>
        ),
      },
    ],
    [t]
  );

  // -------------------------------------------------------------------------

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm());
    setShowModal(true);
  };

  const openEdit = (row: ProjectBillingConfig) => {
    setEditing(row);
    setFormData({
      projectId: row.projectId,
      customerId: row.customer.id,
      billable: row.billable,
    });
    setShowModal(true);
  };

  const openDelete = (row: ProjectBillingConfig) => {
    setDeleting(row);
    setShowDeleteModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.put(`/project-billing-configs/${editing.id}`, formData);
      } else {
        await api.post('/project-billing-configs', formData);
      }
      setShowModal(false);
      setEditing(null);
      fetchData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      await api.delete(`/project-billing-configs/${deleting.id}`);
      setShowDeleteModal(false);
      setDeleting(null);
      fetchData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : t('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
        <Can resource="project_billing_configs" action="create">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t('actions.create')}
          </Button>
        </Can>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>
      )}

      <Card>
        <DataTable
          data={configs}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('searchPlaceholder')}
          emptyMessage={t('empty')}
          pageSize={20}
        />
      </Card>

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        title={editing ? t('modal.editTitle') : t('modal.createTitle')}
        size="md"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="projectId">{t('projectId')} *</Label>
            <Input
              id="projectId"
              type="text"
              value={formData.projectId}
              onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
              placeholder={t('placeholders.projectId')}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{t('hints.projectId')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customerId">{t('customer')} *</Label>
            <Select
              value={formData.customerId}
              onValueChange={(v) => setFormData({ ...formData, customerId: v })}
            >
              <SelectTrigger><SelectValue placeholder={tc('selectCustomer')} /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.externalId && ` (${c.externalId})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="billable">{t('billable')} *</Label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="billable"
                  checked={formData.billable === true}
                  onChange={() => setFormData({ ...formData, billable: true })}
                />
                <span className="text-sm">{t('billableYes')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="billable"
                  checked={formData.billable === false}
                  onChange={() => setFormData({ ...formData, billable: false })}
                />
                <span className="text-sm">{t('billableNo')}</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setShowModal(false); setEditing(null); }}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving || !formData.projectId || !formData.customerId}
            >
              {editing ? tc('save') : tc('create')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeleting(null); }}
        title={t('modal.deleteTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t('modal.deleteConfirm', { projectId: deleting?.projectId || '', customer: deleting?.customer.name || '' })}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setDeleting(null); }}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {tc('delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
