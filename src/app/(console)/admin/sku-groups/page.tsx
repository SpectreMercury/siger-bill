'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api, getAuthToken } from '@/lib/client/api';
import { SkuGroup, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Can } from '@/components/auth';
import { ExternalLink, Upload } from 'lucide-react';

interface ImportSummary {
  fileName: string;
  totalRows: number;
  validRows: number;
  rowErrors: number;
  skus: { unique: number; inserted: number; existing: number };
  skuGroups: { unique: number; inserted: number; existing: number };
  mappings: { unique: number; inserted: number; existing: number; orphan: number };
  errors: Array<{ row: number; reason: string }>;
  orphanPairs: Array<{ skuId: string; code: string }>;
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = getAuthToken();
      const res = await fetch('/api/skus/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Import failed');
      }
      setImportSummary(body as ImportSummary);
      fetchSkuGroups();
    } catch (err) {
      console.error('Import failed:', err);
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        <div className="flex items-center gap-2">
          <Can resource="skus" action="import">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button variant="secondary" onClick={handleUploadClick} isLoading={isImporting}>
              <Upload className="w-4 h-4 mr-2" />
              {t('actions.uploadExcel')}
            </Button>
          </Can>
          <Can resource="sku_groups" action="create">
            <Button onClick={() => setShowModal(true)}>
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('actions.create')}
            </Button>
          </Can>
        </div>
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
        isOpen={!!importSummary}
        onClose={() => setImportSummary(null)}
        title={t('import.resultTitle')}
        size="lg"
      >
        {importSummary && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-muted-foreground">{t('import.fileName')}</div>
                <div className="font-mono">{importSummary.fileName}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('import.totalRows')}</div>
                <div>{importSummary.totalRows}</div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="font-medium">{t('import.skuGroups')}</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">{t('import.unique')}: </span>{importSummary.skuGroups.unique}</div>
                <div><span className="text-muted-foreground">{t('import.inserted')}: </span><span className="text-green-600 font-medium">{importSummary.skuGroups.inserted}</span></div>
                <div><span className="text-muted-foreground">{t('import.existing')}: </span>{importSummary.skuGroups.existing}</div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="font-medium">{t('import.skus')}</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">{t('import.unique')}: </span>{importSummary.skus.unique}</div>
                <div><span className="text-muted-foreground">{t('import.inserted')}: </span><span className="text-green-600 font-medium">{importSummary.skus.inserted}</span></div>
                <div><span className="text-muted-foreground">{t('import.existing')}: </span>{importSummary.skus.existing}</div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="font-medium">{t('import.mappings')}</div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div><span className="text-muted-foreground">{t('import.unique')}: </span>{importSummary.mappings.unique}</div>
                <div><span className="text-muted-foreground">{t('import.inserted')}: </span><span className="text-green-600 font-medium">{importSummary.mappings.inserted}</span></div>
                <div><span className="text-muted-foreground">{t('import.existing')}: </span>{importSummary.mappings.existing}</div>
                <div><span className="text-muted-foreground">{t('import.orphan')}: </span>{importSummary.mappings.orphan}</div>
              </div>
            </div>

            {importSummary.rowErrors > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="font-medium text-amber-900">{t('import.rowErrors')} ({importSummary.rowErrors})</div>
                <ul className="mt-2 space-y-1 text-xs text-amber-800 max-h-40 overflow-auto">
                  {importSummary.errors.map((e, i) => (
                    <li key={i}>Row {e.row}: {e.reason}</li>
                  ))}
                  {importSummary.rowErrors > importSummary.errors.length && (
                    <li className="italic">…{importSummary.rowErrors - importSummary.errors.length} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => setImportSummary(null)}>{tc('close')}</Button>
            </div>
          </div>
        )}
      </Modal>

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
