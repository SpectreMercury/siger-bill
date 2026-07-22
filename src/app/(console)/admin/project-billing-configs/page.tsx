'use client';

/**
 * /admin/project-billing-configs
 *
 * Project registry — one row per GCP project the reseller manages.
 * After the binding refactor this page is decoupled from customers entirely;
 * customer ↔ project binding lives in the customer detail page / list drawer.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api, getAuthToken } from '@/lib/client/api';
import { fetchAllPages } from '@/lib/client/pagination';
import { Customer } from '@/lib/client/types';
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
import { Plus, Pencil, Trash2, Check, X, Filter, Download, Upload, Loader2 } from 'lucide-react';
import { PROJECT_NAME_OPTIONS } from '@/lib/constants/project-names';

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
  chargeType: ChargeType;
  billingAccount: BillingAccountOption | null;
  boundCustomers: Array<{
    customerId: string;
    customerName: string;
    startDate: string | null;
    endDate: string | null;
  }>;
  createdBy: Operator | null;
  updatedBy: Operator | null;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  projectId: string;
  name: string;
  chargeType: ChargeType;
  billingAccountId: string;
  customerId: string;
}

type ChargeType = 'BILLABLE' | 'NON_BILLABLE' | 'CUD' | 'POC' | 'STARTUP';
const CHARGE_TYPES: ChargeType[] = ['BILLABLE', 'NON_BILLABLE', 'CUD', 'POC', 'STARTUP'];

const emptyForm = (): FormData => ({
  projectId: '',
  name: '',
  chargeType: 'BILLABLE',
  billingAccountId: '',
  customerId: '',
});

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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ProjectBillingConfig | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm());
  const [formCustomerSearchQuery, setFormCustomerSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState<ProjectBillingConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Customer multi-select filter state
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [chargeTypeFilter, setChargeTypeFilter] = useState<'all' | ChargeType>('all');

  const filteredCustomers = useMemo(() => {
    const q = customerSearchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.externalId?.toLowerCase().includes(q) ?? false)
    );
  }, [customers, customerSearchQuery]);

  const filteredFormCustomers = useMemo(() => {
    const query = formCustomerSearchQuery.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => (
      customer.name.toLowerCase().includes(query)
      || (customer.externalId?.toLowerCase().includes(query) ?? false)
    ));
  }, [customers, formCustomerSearchQuery]);

  const toggleCustomer = (id: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const customerById = useMemo(() => {
    const m = new Map<string, Customer>();
    customers.forEach((c) => m.set(c.id, c));
    return m;
  }, [customers]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Configs: include customer filter if any selected
      const params = new URLSearchParams();
      if (selectedCustomerIds.length > 0) {
        params.set('customerIds', selectedCustomerIds.join(','));
      }
      if (chargeTypeFilter !== 'all') params.set('chargeType', chargeTypeFilter);
      const configsUrl = `/project-billing-configs?${params.toString()}`;

      const [configsRes, baRes, customersRes] = await Promise.all([
        fetchAllPages<ProjectBillingConfig>(configsUrl),
        fetchAllPages<BillingAccountOption>('/billing-accounts'),
        fetchAllPages<Customer>('/customers'),
      ]);
      setConfigs(configsRes);
      setBillingAccounts(baRes);
      setCustomers(customersRes);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t, selectedCustomerIds, chargeTypeFilter]);

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
        id: 'customer',
        header: t('customer'),
        cell: ({ row }) => row.original.boundCustomers.length > 0 ? (
          <div className="flex max-w-[260px] flex-wrap gap-1">
            {row.original.boundCustomers.map((customer) => (
              <Badge key={customer.customerId} variant="secondary" className="font-normal">
                {customer.customerName}
              </Badge>
            ))}
          </div>
        ) : <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: 'chargeType',
        header: t('billable'),
        cell: ({ row }) => (
          <Badge variant={row.original.chargeType === 'BILLABLE' ? 'default' : 'outline'}>
            {t(`chargeTypes.${row.original.chargeType}`)}
          </Badge>
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
    setFormCustomerSearchQuery('');
    setShowModal(true);
  };

  const openEdit = (row: ProjectBillingConfig) => {
    setEditing(row);
    setFormData({
      projectId: row.projectId,
      name: row.name ?? '',
      chargeType: row.chargeType,
      billingAccountId: row.billingAccount?.id ?? '',
      customerId: row.boundCustomers[0]?.customerId ?? '',
    });
    setFormCustomerSearchQuery('');
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
        chargeType: formData.chargeType,
        billingAccountId: formData.billingAccountId || null,
        customerId: formData.customerId || null,
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

  const handleDownloadTemplate = async () => {
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch('/api/project-billing-configs/template', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) throw new Error(t('templateDownloadFailed'));
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'project-billing-config-template.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templateDownloadFailed'));
    }
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    setIsImporting(true);
    setError(null);
    setImportMessage(null);
    try {
      const form = new window.FormData();
      form.set('file', file);
      const token = getAuthToken();
      const response = await fetch('/api/project-billing-configs/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || t('importFailed'));
      setImportMessage(t('importSuccess', {
        created: body.createdCount ?? 0,
        updated: body.updatedCount ?? 0,
      }));
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('importFailed'));
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            {t('actions.downloadTemplate')}
          </Button>
          <Can resource="project_billing_configs" action="create">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(event) => handleImport(event.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Upload className="h-4 w-4 mr-2" />}
              {t('actions.import')}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              {t('actions.create')}
            </Button>
          </Can>
        </div>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>
      )}
      {importMessage && (
        <Alert variant="success" onClose={() => setImportMessage(null)}>{importMessage}</Alert>
      )}

      {/* Filter bar */}
      <Card className="p-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span>{t('filters.title')}</span>
          </div>

          {/* Selected customer chips */}
          {selectedCustomerIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedCustomerIds.map((id) => {
                const c = customerById.get(id);
                if (!c) return null;
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {c.name}
                    {c.externalId && <span className="text-muted-foreground text-xs">({c.externalId})</span>}
                    <button
                      type="button"
                      onClick={() => toggleCustomer(id)}
                      className="hover:text-destructive ml-0.5"
                      aria-label={`Remove ${c.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedCustomerIds([])}
                className="text-xs text-muted-foreground hover:text-foreground underline ml-1 self-center"
              >
                {t('filters.clearAll')}
              </button>
            </div>
          )}

          {/* Customer searchable dropdown */}
          <div className="grid gap-3 md:grid-cols-[minmax(280px,1fr)_240px]">
            <div className="relative max-w-md">
              <Input
                type="text"
                placeholder={t('filters.customerSearchPlaceholder')}
                value={customerSearchQuery}
                onChange={(e) => { setCustomerSearchQuery(e.target.value); setCustomerDropdownOpen(true); }}
                onFocus={() => setCustomerDropdownOpen(true)}
                onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
              />
              {customerDropdownOpen && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
                {filteredCustomers.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {t('filters.noCustomers')}
                  </div>
                ) : (
                  filteredCustomers.map((c) => {
                    const selected = selectedCustomerIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); toggleCustomer(c.id); }}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-muted/50 ${selected ? 'bg-primary/5' : ''}`}
                      >
                        <Check className={`h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                        <span className="flex-1">{c.name}</span>
                        {c.externalId && (
                          <span className="text-xs text-muted-foreground font-mono">{c.externalId}</span>
                        )}
                      </button>
                    );
                  })
                )}
                </div>
              )}
            </div>
            <Select
              value={chargeTypeFilter}
              onValueChange={(value: 'all' | ChargeType) => setChargeTypeFilter(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('filters.chargeType')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filters.allChargeTypes')}</SelectItem>
                {CHARGE_TYPES.map((chargeType) => (
                  <SelectItem key={chargeType} value={chargeType}>
                    {t(`chargeTypes.${chargeType}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('filters.customerFilterHint')}
          </p>
        </div>
      </Card>

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
        onClose={() => { setShowModal(false); setEditing(null); setFormCustomerSearchQuery(''); }}
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
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('placeholders.name')}
              list={PROJECT_NAME_OPTIONS.length > 0 ? 'project-name-options' : undefined}
            />
            {PROJECT_NAME_OPTIONS.length > 0 && (
              <datalist id="project-name-options">
                {PROJECT_NAME_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="customerId">{t('customer')}</Label>
            <Input
              id="customerId"
              value={formCustomerSearchQuery}
              onChange={(event) => setFormCustomerSearchQuery(event.target.value)}
              placeholder={t('customerSearchPlaceholder')}
            />
            <div className="max-h-44 overflow-y-auto rounded-md border p-1" role="listbox">
              <button
                type="button"
                role="option"
                aria-selected={!formData.customerId}
                onClick={() => setFormData({ ...formData, customerId: '' })}
                className={`w-full rounded px-2 py-1.5 text-left text-sm ${
                  !formData.customerId ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                }`}
              >
                {t('noCustomer')}
              </button>
              {filteredFormCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  role="option"
                  aria-selected={formData.customerId === customer.id}
                  onClick={() => setFormData({ ...formData, customerId: customer.id })}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm ${
                    formData.customerId === customer.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted'
                  }`}
                >
                  {customer.name}{customer.externalId ? ` (${customer.externalId})` : ''}
                </button>
              ))}
            </div>
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
            <Select
              value={formData.chargeType}
              onValueChange={(chargeType: ChargeType) => setFormData({ ...formData, chargeType })}
            >
              <SelectTrigger id="billable">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHARGE_TYPES.map((chargeType) => (
                  <SelectItem key={chargeType} value={chargeType}>
                    {t(`chargeTypes.${chargeType}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
