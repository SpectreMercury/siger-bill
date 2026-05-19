'use client';

/**
 * /admin/project-billing-configs
 *
 * Project registry — one row per GCP project the reseller manages.
 * After the binding refactor this page is decoupled from customers entirely;
 * customer ↔ project binding lives in the customer detail page / list drawer.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { PaginatedResponse } from '@/lib/client/types';
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
import {
  PROJECT_NAME_OPTIONS,
  HAS_PROJECT_NAME_OPTIONS,
} from '@/lib/constants/project-names';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Operator {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface BillingAccountOption {
  id: string;
  billingAccountId: string;
  name: string | null;
}

interface ProjectBillingConfig {
  id: string;
  projectId: string;
  name: string | null;
  billable: boolean;
  billingAccount: BillingAccountOption | null;
  createdBy: Operator | null;
  updatedBy: Operator | null;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  projectId: string;
  name: string;
  billable: boolean;
  billingAccountId: string;
}

const emptyForm = (): FormData => ({ projectId: '', name: '', billable: true, billingAccountId: '' });

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
  const [billingAccounts, setBillingAccounts] = useState<BillingAccountOption[]>([]);
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
      const [configsRes, baRes] = await Promise.all([
        api.get<PaginatedResponse<ProjectBillingConfig>>('/project-billing-configs?limit=200'),
        api.get<PaginatedResponse<BillingAccountOption>>('/billing-accounts?limit=200'),
      ]);
      setConfigs(configsRes.data || []);
      setBillingAccounts(baRes.data || []);
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
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => row.original.name || <span className="text-muted-foreground">—</span>,
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
        accessorKey: 'billingAccount',
        header: t('billingAccount'),
        cell: ({ row }) =>
          row.original.billingAccount?.name ||
          row.original.billingAccount?.billingAccountId ||
          <span className="text-muted-foreground">—</span>,
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
      name: row.name ?? '',
      billable: row.billable,
      billingAccountId: row.billingAccount?.id ?? '',
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
      const payload = {
        projectId: formData.projectId.trim(),
        name: formData.name.trim() || null,
        billable: formData.billable,
        billingAccountId: formData.billingAccountId || null,
      };
      if (editing) {
        await api.put(`/project-billing-configs/${editing.id}`, payload);
      } else {
        await api.post('/project-billing-configs', payload);
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
              disabled={editing !== null}
            />
            <p className="text-xs text-muted-foreground">{t('hints.projectId')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t('name')}</Label>
            {HAS_PROJECT_NAME_OPTIONS ? (
              <Select
                value={formData.name || 'none'}
                onValueChange={(v) => setFormData({ ...formData, name: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('placeholders.name')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {PROJECT_NAME_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('placeholders.name')}
                />
                <p className="text-xs text-amber-600">{t('hints.nameOptionsTodo')}</p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="billingAccount">{t('billingAccount')}</Label>
            <Select
              value={formData.billingAccountId || 'none'}
              onValueChange={(v) => setFormData({ ...formData, billingAccountId: v === 'none' ? '' : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('placeholders.billingAccount')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {billingAccounts.map((ba) => (
                  <SelectItem key={ba.id} value={ba.id}>
                    {ba.name || ba.billingAccountId}
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
              disabled={isSaving || !formData.projectId}
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
            {t('modal.deleteConfirm', { projectId: deleting?.projectId || '' })}
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
