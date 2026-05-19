'use client';

/**
 * Customer detail tab — list of bound projects + entry point for the same
 * ManageProjectsDrawer used on the customer list page.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { PaginatedResponse } from '@/lib/client/types';
import { DataTable, Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Can } from '@/components/auth';
import { ManageProjectsDrawer } from './ManageProjectsDrawer';
import { Plus, Unlink } from 'lucide-react';

interface CustomerProjectRow {
  id: string;
  projectId: string;
  projectName: string | null;
  billable: boolean;
  billingAccount: {
    billingAccountId: string;
    name: string | null;
  } | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CustomerProjectsTabProps {
  customerId: string;
  customerName?: string;
}

export function CustomerProjectsTab({ customerId, customerName }: CustomerProjectsTabProps) {
  const t = useTranslations('customerProjects');
  const [rows, setRows] = useState<CustomerProjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedResponse<CustomerProjectRow>>(
        `/customers/${customerId}/projects?limit=200`
      );
      setRows(res.data ?? []);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [customerId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUnbind = useCallback(
    async (projectId: string) => {
      if (!confirm(t('confirmUnbind', { projectId }))) return;
      try {
        await api.delete(`/customers/${customerId}/projects/${encodeURIComponent(projectId)}`);
        fetchData();
      } catch (err) {
        console.error('Error unbinding project:', err);
        setError(t('unbindFailed'));
      }
    },
    [customerId, fetchData, t]
  );

  const columns: ColumnDef<CustomerProjectRow>[] = useMemo(
    () => [
      {
        accessorKey: 'projectId',
        header: t('projectId'),
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-sm">{row.original.projectId}</div>
            {row.original.projectName && (
              <div className="text-xs text-muted-foreground">{row.original.projectName}</div>
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
            <Badge variant="outline" className="text-muted-foreground">
              {t('billableNo')}
            </Badge>
          ),
      },
      {
        accessorKey: 'billingAccount',
        header: t('billingAccount'),
        cell: ({ row }) =>
          row.original.billingAccount?.name ||
          row.original.billingAccount?.billingAccountId ||
          '—',
      },
      {
        accessorKey: 'startDate',
        header: t('startDate'),
        cell: ({ row }) =>
          row.original.startDate ? new Date(row.original.startDate).toLocaleDateString() : '—',
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Can resource="customer_projects" action="unbind">
            {row.original.isActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUnbind(row.original.projectId)}
              >
                <Unlink className="h-4 w-4 mr-1" />
                {t('unbind')}
              </Button>
            )}
          </Can>
        ),
      },
    ],
    [t, handleUnbind]
  );

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t('heading')}</h3>
        <Can resource="customer_projects" action="bind">
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('manage')}
          </Button>
        </Can>
      </div>

      {error && (
        <Alert variant="error" className="mb-4" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable
        data={rows}
        columns={columns}
        isLoading={isLoading}
        emptyMessage={t('empty')}
        pageSize={10}
      />

      <ManageProjectsDrawer
        customerId={drawerOpen ? customerId : null}
        customerName={customerName ?? ''}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={fetchData}
      />
    </Card>
  );
}
