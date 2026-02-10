'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable, Alert } from '@/components/ui';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Label } from '@/components/ui/shadcn/label';
import { Upload, Database, FileCheck } from 'lucide-react';

interface ImportBatch {
  id: string;
  month: string | null;
  source: string;
  rowCount: number;
  checksum: string | null;
  status: string;
  createdBy: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  createdAt: string;
  entryCount: number;
  totalCost: number;
}

interface FiltersResponse {
  months: string[];
  sources: string[];
}

export default function RawCostImportsPage() {
  const t = useTranslations('costImports');
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>([]);

  // Filters
  const [monthFilter, setMonthFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');

  const fetchBatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (monthFilter) params.set('month', monthFilter);
      if (sourceFilter) params.set('source', sourceFilter);

      const response = await api.get<{
        data: ImportBatch[];
        filters: FiltersResponse;
      }>(`/raw-cost-imports?${params.toString()}`);

      setBatches(response.data || []);
      setAvailableMonths(response.filters?.months || []);
      setAvailableSources(response.filters?.sources || []);
    } catch (err) {
      console.error('Error fetching import batches:', err);
      setError('Failed to load import batches');
    } finally {
      setIsLoading(false);
    }
  }, [monthFilter, sourceFilter]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatMonth = (month: string): string => {
    const [year, monthNum] = month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  };

  const columns: ColumnDef<ImportBatch>[] = useMemo(
    () => [
      {
        accessorKey: 'createdAt',
        header: t('importTime'),
        cell: ({ row }) => (
          <div className="text-sm">
            <p className="font-medium">
              {new Date(row.original.createdAt).toLocaleDateString()}
            </p>
            <p className="text-muted-foreground text-xs">
              {new Date(row.original.createdAt).toLocaleTimeString()}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'month',
        header: t('month'),
        cell: ({ row }) =>
          row.original.month ? (
            <Badge variant="secondary">{formatMonth(row.original.month)}</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        accessorKey: 'source',
        header: t('source'),
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono text-xs">
            {row.original.source}
          </Badge>
        ),
      },
      {
        accessorKey: 'rowCount',
        header: t('rows'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.rowCount.toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: 'totalCost',
        header: t('totalCost'),
        cell: ({ row }) => (
          <span className="font-medium">
            {formatCurrency(row.original.totalCost)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === 'COMPLETED'
                ? 'default'
                : row.original.status === 'FAILED'
                ? 'destructive'
                : 'secondary'
            }
          >
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: 'createdBy',
        header: t('importedBy'),
        cell: ({ row }) => (
          <div className="text-sm">
            <p>
              {row.original.createdBy.firstName} {row.original.createdBy.lastName}
            </p>
            <p className="text-muted-foreground text-xs">
              {row.original.createdBy.email}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'checksum',
        header: t('checksum'),
        cell: ({ row }) =>
          row.original.checksum ? (
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {row.original.checksum.slice(0, 12)}...
            </code>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
    ],
    [t]
  );

  // Calculate summary stats
  const summary = useMemo(() => {
    return {
      totalBatches: batches.length,
      totalRows: batches.reduce((sum, b) => sum + b.rowCount, 0),
      totalCost: batches.reduce((sum, b) => sum + b.totalCost, 0),
    };
  }, [batches]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('subtitle')}
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('summary.totalBatches')}</p>
              <p className="text-2xl font-bold">{summary.totalBatches}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('summary.totalRows')}</p>
              <p className="text-2xl font-bold">
                {summary.totalRows.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FileCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('summary.totalCost')}</p>
              <p className="text-2xl font-bold">{formatCurrency(summary.totalCost)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>{t('filters.month')}</Label>
            <Select value={monthFilter || 'all'} onValueChange={(v) => setMonthFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t('filters.allMonths')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filters.allMonths')}</SelectItem>
                {availableMonths.map((month) => (
                  <SelectItem key={month} value={month}>
                    {formatMonth(month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('filters.source')}</Label>
            <Select value={sourceFilter || 'all'} onValueChange={(v) => setSourceFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t('filters.allSources')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filters.allSources')}</SelectItem>
                {availableSources.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Batches Table */}
      <Card>
        <DataTable
          data={batches}
          columns={columns}
          isLoading={isLoading}
          emptyMessage={t('noImports')}
          pageSize={20}
        />
      </Card>
    </div>
  );
}
