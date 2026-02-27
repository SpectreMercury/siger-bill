'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { Customer, PaginatedResponse } from '@/lib/client/types';
import { useAuth } from '@/contexts/AuthContext';
import { DataTable, StatusBadge, Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
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
import { Plus, ExternalLink, Cloud } from 'lucide-react';
import Link from 'next/link';

interface GcpConnectionOption {
  id: string;
  name: string;
  group: string;
  authType: string;
}

interface CustomerFormData {
  name: string;
  externalId: string;
  currency: string;
  paymentTermsDays: number;
  primaryContactEmail: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  gcpConnectionId: string | null;
}

export default function CustomersPage() {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const { isSuperAdmin } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>({
    name: '',
    externalId: '',
    currency: 'USD',
    paymentTermsDays: 30,
    primaryContactEmail: '',
    status: 'ACTIVE',
    gcpConnectionId: null,
  });
  const [isSaving, setIsSaving] = useState(false);

  // GCP connection options (super admin only)
  const [gcpConnections, setGcpConnections] = useState<GcpConnectionOption[]>([]);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PaginatedResponse<Customer>>('/customers');
      setCustomers(response.data || []);
    } catch (err) {
      console.error('Error fetching customers:', err);
      setError('Failed to load customers');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load GCP connections for the dropdown (super admin only)
  const fetchGcpConnections = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await api.get<{ data: GcpConnectionOption[] }>('/admin/gcp-connections');
      setGcpConnections(res.data ?? []);
    } catch {
      // silently ignore — not critical
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    fetchCustomers();
    fetchGcpConnections();
  }, [fetchCustomers, fetchGcpConnections]);

  const columns: ColumnDef<Customer>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <Link href={`/admin/customers/${row.original.id}`} className="block hover:opacity-80">
            <div className="font-medium text-primary">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.externalId}</div>
          </Link>
        ),
      },
      {
        accessorKey: 'currency',
        header: t('currency'),
      },
      {
        accessorKey: 'paymentTermsDays',
        header: t('paymentTerms'),
        cell: ({ row }) => `${row.original.paymentTermsDays} days`,
      },
      {
        accessorKey: 'primaryContactEmail',
        header: t('contactEmail'),
        cell: ({ row }) => row.original.primaryContactEmail || '-',
      },
      {
        id: 'gcpConnection',
        header: t('gcpConnection'),
        cell: ({ row }) => {
          if (!row.original.gcpConnectionId) return <span className="text-muted-foreground text-xs">-</span>;
          const conn = gcpConnections.find((c) => c.id === row.original.gcpConnectionId);
          return (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Cloud className="h-3 w-3" />
              {conn?.name ?? row.original.gcpConnectionId.slice(0, 8) + '...'}
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Can resource="customers" action="update">
              <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
                {tc('edit')}
              </Button>
            </Can>
            <Link href={`/admin/customers/${row.original.id}`}>
              <Button variant="ghost" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" />
                {tc('view')}
              </Button>
            </Link>
          </div>
        ),
      },
    ],
    [t, tc, gcpConnections]
  );

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      externalId: customer.externalId || '',
      currency: customer.currency,
      paymentTermsDays: customer.paymentTermsDays,
      primaryContactEmail: customer.primaryContactEmail || '',
      status: customer.status,
      gcpConnectionId: customer.gcpConnectionId ?? null,
    });
    setShowCreateModal(true);
  };

  const handleCreate = () => {
    setEditingCustomer(null);
    setFormData({
      name: '',
      externalId: '',
      currency: 'USD',
      paymentTermsDays: 30,
      primaryContactEmail: '',
      status: 'ACTIVE',
      gcpConnectionId: null,
    });
    setShowCreateModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...formData,
        gcpConnectionId: formData.gcpConnectionId || null,
      };
      if (editingCustomer) {
        await api.put(`/customers/${editingCustomer.id}`, payload);
      } else {
        await api.post('/customers', payload);
      }
      setShowCreateModal(false);
      fetchCustomers();
    } catch (err) {
      console.error('Error saving customer:', err);
      setError('Failed to save customer');
    } finally {
      setIsSaving(false);
    }
  };

  // Group GCP connections by group for the select
  const gcpConnectionGroups = useMemo(() => {
    const groups: Record<string, GcpConnectionOption[]> = {};
    for (const c of gcpConnections) {
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    }
    return groups;
  }, [gcpConnections]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
        <Can resource="customers" action="create">
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t('actions.create')}
          </Button>
        </Can>
      </div>

      {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Table */}
      <Card>
        <DataTable
          data={customers}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('searchPlaceholder')}
          emptyMessage={t('noCustomers')}
          pageSize={20}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={editingCustomer ? t('modal.editTitle') : t('modal.createTitle')}
        size="md"
      >
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('name')} *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="externalId">{t('externalId')}</Label>
            <Input
              id="externalId"
              value={formData.externalId}
              onChange={(e) => setFormData({ ...formData, externalId: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currency">{t('currency')}</Label>
              <Select value={formData.currency} onValueChange={(v) => setFormData({ ...formData, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="JPY">JPY</SelectItem>
                  <SelectItem value="CNY">CNY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentTerms">{t('paymentTermsDays')}</Label>
              <Input
                id="paymentTerms"
                type="number"
                value={formData.paymentTermsDays}
                onChange={(e) => setFormData({ ...formData, paymentTermsDays: parseInt(e.target.value) || 30 })}
                min={1}
                max={180}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactEmail">{t('primaryContactEmail')}</Label>
            <Input
              id="contactEmail"
              type="email"
              value={formData.primaryContactEmail}
              onChange={(e) => setFormData({ ...formData, primaryContactEmail: e.target.value })}
            />
          </div>

          {/* GCP Connection — super admin only */}
          {isSuperAdmin && (
            <div className="space-y-2">
              <Label htmlFor="gcpConnection" className="flex items-center gap-1">
                <Cloud className="h-3.5 w-3.5" />
                {t('gcpConnection')}
              </Label>
              <Select
                value={formData.gcpConnectionId ?? 'none'}
                onValueChange={(v) => setFormData({ ...formData, gcpConnectionId: v === 'none' ? null : v })}
              >
                <SelectTrigger id="gcpConnection">
                  <SelectValue placeholder={t('gcpConnectionPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('gcpConnectionNone')}</SelectItem>
                  {Object.entries(gcpConnectionGroups).map(([group, conns]) => (
                    conns.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        <span className="text-xs text-muted-foreground mr-1">[{group}]</span>
                        {conn.name}
                      </SelectItem>
                    ))
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('gcpConnectionHint')}</p>
            </div>
          )}

          {editingCustomer && (
            <div className="space-y-2">
              <Label htmlFor="status">{t('status')}</Label>
              <Select
                value={formData.status}
                onValueChange={(v: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED') => setFormData({ ...formData, status: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">{t('statuses.active')}</SelectItem>
                  <SelectItem value="SUSPENDED">{t('statuses.suspended')}</SelectItem>
                  <SelectItem value="TERMINATED">{t('statuses.terminated')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {editingCustomer ? tc('update') : tc('create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
