'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import {
  Database,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  Clock,
  XCircle,
} from 'lucide-react';

interface ImportBatch {
  id: string;
  month: string | null;
  source: string;
  rowCount: number;
  status: string;
  createdAt: string;
  totalCost: number;
}

interface InvoiceRun {
  id: string;
  billingMonth: string;
  status: string;
  totalInvoices: number | null;
  totalAmount: string | null;
  createdAt: string;
}

interface AlertItem {
  id: string;
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
  link?: string;
}

export function RecentImportsWidget() {
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRecentImports = async () => {
      try {
        const response = await api.get<{ data: ImportBatch[] }>('/raw-cost-imports?limit=5');
        setImports(response.data || []);
      } catch (error) {
        console.error('Failed to fetch recent imports:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRecentImports();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Recent Imports</h3>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Recent Imports</h3>
        </div>
        <Link href="/admin/raw-cost-imports">
          <Button variant="ghost" size="sm">
            View All
            <ExternalLink className="h-4 w-4 ml-1" />
          </Button>
        </Link>
      </div>

      {imports.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-4">No imports yet</p>
      ) : (
        <div className="space-y-3">
          {imports.map((batch) => (
            <div
              key={batch.id}
              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <Badge
                  variant={batch.status === 'COMPLETED' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {batch.source}
                </Badge>
                <div className="text-sm">
                  <p className="font-medium">
                    {batch.rowCount.toLocaleString()} rows
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatDate(batch.createdAt)}
                  </p>
                </div>
              </div>
              <span className="font-medium text-sm">
                {formatCurrency(batch.totalCost)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function RecentInvoiceRunsWidget() {
  const [runs, setRuns] = useState<InvoiceRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRecentRuns = async () => {
      try {
        const response = await api.get<{ data: InvoiceRun[] }>('/invoice-runs?limit=5');
        setRuns(response.data || []);
      } catch (error) {
        console.error('Failed to fetch recent invoice runs:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRecentRuns();
  }, []);

  const formatCurrency = (value: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(parseFloat(value));
  };

  const formatMonth = (month: string) => {
    const [year, monthNum] = month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SUCCEEDED':
      case 'LOCKED':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'RUNNING':
      case 'QUEUED':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Recent Invoice Runs</h3>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Recent Invoice Runs</h3>
        </div>
        <Link href="/admin/invoice-runs">
          <Button variant="ghost" size="sm">
            View All
            <ExternalLink className="h-4 w-4 ml-1" />
          </Button>
        </Link>
      </div>

      {runs.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-4">No invoice runs yet</p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <Link key={run.id} href={`/admin/invoice-runs/${run.id}`}>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors">
                <div className="flex items-center gap-3">
                  {getStatusIcon(run.status)}
                  <div className="text-sm">
                    <p className="font-medium">{formatMonth(run.billingMonth)}</p>
                    <p className="text-muted-foreground text-xs">
                      {run.totalInvoices || 0} invoices
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge
                    variant={
                      run.status === 'SUCCEEDED' || run.status === 'LOCKED'
                        ? 'default'
                        : run.status === 'FAILED'
                        ? 'destructive'
                        : 'secondary'
                    }
                    className="text-xs"
                  >
                    {run.status}
                  </Badge>
                  {run.totalAmount && (
                    <p className="font-medium text-sm mt-1">
                      {formatCurrency(run.totalAmount)}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

export function SystemAlertsWidget() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAlerts = async () => {
      const alertsList: AlertItem[] = [];

      try {
        // Check for unassigned projects
        const reconciliation = await api.get<{
          unassignedProjects: Array<{ projectId: string; cost: number }>;
          unassignedCostTotal: number;
        }>('/reconciliation?month=' + getCurrentMonth());

        if (reconciliation.unassignedProjects?.length > 0) {
          alertsList.push({
            id: 'unassigned-projects',
            type: 'warning',
            title: 'Unassigned Projects',
            message: `${reconciliation.unassignedProjects.length} project(s) with costs are not assigned to any customer`,
            link: '/admin/reconciliation',
          });
        }
      } catch {
        // Reconciliation API might not be available
      }

      try {
        // Check for failed invoice runs
        const runs = await api.get<{ data: InvoiceRun[] }>('/invoice-runs?status=FAILED&limit=5');
        if (runs.data?.length > 0) {
          alertsList.push({
            id: 'failed-runs',
            type: 'error',
            title: 'Failed Invoice Runs',
            message: `${runs.data.length} invoice run(s) have failed`,
            link: '/admin/invoice-runs',
          });
        }
      } catch {
        // Invoice runs API might not be available
      }

      setAlerts(alertsList);
      setIsLoading(false);
    };

    checkAlerts();
  }, []);

  const getCurrentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">System Alerts</h3>
        </div>
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">System Alerts</h3>
        </div>
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <CheckCircle2 className="h-5 w-5 mr-2 text-green-500" />
          <span className="text-sm">No active alerts</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">System Alerts</h3>
        <Badge variant="destructive" className="ml-auto">
          {alerts.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`p-3 rounded-lg border ${
              alert.type === 'error'
                ? 'bg-red-500/10 border-red-500/20'
                : alert.type === 'warning'
                ? 'bg-yellow-500/10 border-yellow-500/20'
                : 'bg-blue-500/10 border-blue-500/20'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p
                  className={`font-medium text-sm ${
                    alert.type === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : alert.type === 'warning'
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {alert.title}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
              </div>
              {alert.link && (
                <Link href={alert.link}>
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
