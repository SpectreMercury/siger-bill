'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, getAuthToken } from '@/lib/client/api';
import { Customer } from '@/lib/client/types';
import { Alert } from '@/components/ui';
import { Card } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Badge } from '@/components/ui/shadcn/badge';
import { CloudDownload, Download, Loader2, RotateCcw, Upload } from 'lucide-react';

type BillingCell = string | number | null;

interface MonthlyBillingResponse {
  headers: string[];
  rows: BillingCell[][];
  activeOverride: ActiveOverride | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface ActiveOverride {
  id: string;
  sourceFilename: string;
  uploadedAt: string;
  rowCount: number;
}

type BillingSyncJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

interface BillingSyncJob {
  id: string;
  billingMonth: string;
  status: BillingSyncJobStatus;
  totalRows: number;
  errors: string[];
  errorMessage: string | null;
  sourceConflictCount?: number;
  sourceConflicts?: SourceConflict[];
}

interface SourceConflict {
  projectId: string;
  distinctSourceCount: number;
  totalRows: number;
  sourceLabels: string[];
}

function defaultBillingMonth() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function MonthlyBillingPage() {
  const t = useTranslations('monthlyBilling');
  const tc = useTranslations('common');

  const [billingMonth, setBillingMonth] = useState(defaultBillingMonth());
  const [customerId, setCustomerId] = useState('all');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<BillingCell[][]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [activeOverride, setActiveOverride] = useState<ActiveOverride | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploadingOverride, setIsUploadingOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCustomerId = customerId === 'all' ? undefined : customerId;

  const fetchCustomers = useCallback(async () => {
    try {
      const response = await api.get<{ data: Customer[] }>('/customers?limit=1000');
      setCustomers(response.data || []);
    } catch (err) {
      console.error('Failed to load customers:', err);
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('billingMonth', billingMonth);
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (selectedCustomerId) params.set('customerId', selectedCustomerId);

      const response = await api.get<MonthlyBillingResponse>(`/billing/monthly-lines?${params.toString()}`);
      setHeaders(response.headers);
      setRows(response.rows);
      setActiveOverride(response.activeOverride ?? null);
      setTotal(response.pagination.total);
      setTotalPages(response.pagination.totalPages);
    } catch (err) {
      console.error('Failed to load monthly billing:', err);
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [billingMonth, limit, page, selectedCustomerId, t]);

  const syncWarningFromJob = useCallback((job: BillingSyncJob) => {
    if (!job.sourceConflicts || job.sourceConflicts.length === 0) return null;

    const preview = job.sourceConflicts
      .slice(0, 3)
      .map((conflict) => `${conflict.projectId}: ${conflict.sourceLabels.join(' / ')}`)
      .join('; ');

    return `Updated BigQuery data, but ${job.sourceConflictCount ?? job.sourceConflicts.length} overlapping project(s) were found. Invoice execution is blocked until source mappings are resolved. ${preview}`;
  }, []);

  const pollSyncJob = useCallback((jobId: string) => {
    const poll = async () => {
      try {
        const response = await api.get<{ job: BillingSyncJob }>(`/billing/sync-jobs/${jobId}`);
        const job = response.job;

        if (job.status === 'QUEUED' || job.status === 'RUNNING') {
          window.setTimeout(poll, 3000);
          return;
        }

        if (job.status === 'SUCCEEDED') {
          setSyncMessage(t('syncSuccess', { count: job.totalRows }));
          setSyncWarning(syncWarningFromJob(job));
          setPage(1);
          await fetchRows();
          setIsSyncing(false);
          return;
        }

        setError(job.errorMessage || job.errors.join('; ') || t('syncFailed'));
        setIsSyncing(false);
      } catch (err) {
        console.error('Failed to poll BigQuery billing sync:', err);
        setError(err instanceof Error ? err.message : t('syncFailed'));
        setIsSyncing(false);
      }
    };

    void poll();
  }, [fetchRows, syncWarningFromJob, t]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const customerOptions = useMemo(
    () => customers.filter((customer) => customer.status === 'ACTIVE'),
    [customers]
  );

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('billingMonth', billingMonth);
      if (selectedCustomerId) params.set('customerId', selectedCustomerId);

      const token = getAuthToken();
      const response = await fetch(`/api/billing/monthly-lines/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || t('exportFailed'));
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition');
      const filename = disposition?.match(/filename="([^"]+)"/)?.[1] || `billing-${billingMonth}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export monthly billing:', err);
      setError(err instanceof Error ? err.message : t('exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleSyncBigQuery = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncMessage(null);
    setSyncWarning(null);
    try {
      const response = await api.post<{ job: BillingSyncJob }>('/billing/sync-jobs', {
        billingMonth,
        customerId: selectedCustomerId,
      });
      pollSyncJob(response.job.id);
    } catch (err) {
      console.error('Failed to sync BigQuery billing:', err);
      setError(err instanceof Error ? err.message : t('syncFailed'));
      setIsSyncing(false);
    }
  };

  const handleUploadOverride = async (file: File | null) => {
    if (!file) return;
    setIsUploadingOverride(true);
    setError(null);
    setSyncMessage(null);
    setSyncWarning(null);
    try {
      const formData = new FormData();
      formData.set('billingMonth', billingMonth);
      if (selectedCustomerId) formData.set('customerId', selectedCustomerId);
      formData.set('file', file);

      const token = getAuthToken();
      const response = await fetch('/api/billing/monthly-lines/overrides', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to upload override');
      }

      setSyncMessage(`Override uploaded: ${body.activeOverride?.rowCount ?? 0} rows`);
      setPage(1);
      await fetchRows();
    } catch (err) {
      console.error('Failed to upload monthly billing override:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload override');
    } finally {
      setIsUploadingOverride(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetPageAndFetch = () => {
    setPage(1);
    if (page === 1) fetchRows();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleSyncBigQuery} disabled={isSyncing || isLoading}>
            {isSyncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CloudDownload className="h-4 w-4 mr-2" />
            )}
            {t('syncBigQuery')}
          </Button>
          <Button variant="outline" onClick={fetchRows} disabled={isLoading}>
            <RotateCcw className="h-4 w-4 mr-2" />
            {tc('refresh')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => handleUploadOverride(event.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingOverride || isLoading}
          >
            {isUploadingOverride ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Upload Override
          </Button>
          <Button onClick={handleExport} disabled={isExporting || total === 0}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {t('exportExcel')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {syncMessage && (
        <Alert variant="success" onClose={() => setSyncMessage(null)}>
          {syncMessage}
        </Alert>
      )}

      {syncWarning && (
        <Alert variant="warning" onClose={() => setSyncWarning(null)}>
          {syncWarning}
        </Alert>
      )}

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_280px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="billingMonth">{t('billingMonth')}</Label>
            <Input
              id="billingMonth"
              type="month"
              value={billingMonth}
              onChange={(event) => {
                setBillingMonth(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('customer')}</Label>
            <Select
              value={customerId}
              onValueChange={(value) => {
                setCustomerId(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allCustomers')}</SelectItem>
                {customerOptions.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="secondary" onClick={resetPageAndFetch} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t('apply')}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{billingMonth}</Badge>
            {activeOverride && (
              <Badge variant="outline" title={`Uploaded ${new Date(activeOverride.uploadedAt).toLocaleString()}`}>
                Override: {activeOverride.sourceFilename}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {t('rowCount', { count: total })}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {t('pageInfo', { page, totalPages: Math.max(totalPages, 1) })}
          </span>
        </div>

        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <div className="max-h-[68vh] overflow-auto">
            <table className="min-w-[2600px] text-sm">
              <thead className="sticky top-0 z-[1] bg-muted">
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="whitespace-nowrap border-b px-3 py-2 text-left font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(headers.length, 1)} className="h-48 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rowIndex) => (
                    <tr key={`${page}-${rowIndex}`} className="odd:bg-background even:bg-muted/20">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${rowIndex}-${cellIndex}`}
                          className="max-w-[280px] truncate border-b px-3 py-2 font-mono text-xs"
                          title={cell == null ? '' : String(cell)}
                        >
                          {cell == null || cell === '' ? '-' : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
            disabled={page <= 1 || isLoading}
          >
            {tc('previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => current + 1)}
            disabled={page >= totalPages || isLoading}
          >
            {tc('next')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
