'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/client/api';
import { Button, Alert } from '@/components/ui';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Search, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react';

interface ReconciliationSummary {
  rawCostTotal: number;
  rawCostEntryCount: number;
  invoicedSubtotal: number;
  invoicedTax: number;
  invoicedTotal: number;
  invoiceCount: number;
  variance: number;
  variancePercent: number;
}

interface CustomerBreakdown {
  customerId: string;
  customerName: string;
  rawCost: number;
  invoicedAmount: number;
  variance: number;
}

interface UnassignedProject {
  projectId: string;
  cost: number;
}

interface InvoiceRunSummary {
  id: string;
  status: string;
  totalInvoices: number;
  totalAmount: string | null;
  createdAt: string;
}

interface ReconciliationData {
  month: string;
  summary: ReconciliationSummary;
  customerBreakdown: CustomerBreakdown[];
  unassignedProjects: UnassignedProject[];
  unassignedCostTotal: number;
  invoiceRuns: InvoiceRunSummary[];
}

export default function ReconciliationPage() {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchReconciliation = useCallback(async () => {
    if (!selectedMonth) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<ReconciliationData>(
        `/reconciliation?month=${selectedMonth}`
      );
      setData(response);
    } catch (err) {
      console.error('Error fetching reconciliation:', err);
      setError('Failed to load reconciliation data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetchReconciliation();
  }, [fetchReconciliation]);

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatMonth = (month: string): string => {
    const [year, monthNum] = month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Compare raw costs with invoiced amounts
        </p>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Month Selector */}
      <Card className="p-4">
        <div className="flex items-end gap-4">
          <div className="flex-1 max-w-xs">
            <Label>Billing Month</Label>
            <Input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button onClick={fetchReconciliation} disabled={isLoading}>
            <Search className="h-4 w-4 mr-2" />
            {isLoading ? 'Loading...' : 'Generate Report'}
          </Button>
        </div>
      </Card>

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Raw Cost Total</p>
              <p className="text-2xl font-bold">
                {formatCurrency(data.summary.rawCostTotal)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.summary.rawCostEntryCount.toLocaleString()} entries
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Invoiced Total</p>
              <p className="text-2xl font-bold">
                {formatCurrency(data.summary.invoicedTotal)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.summary.invoiceCount} invoices
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Variance</p>
              <p
                className={`text-2xl font-bold ${
                  data.summary.variance >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {data.summary.variance >= 0 ? '+' : ''}
                {formatCurrency(data.summary.variance)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.summary.variancePercent >= 0 ? '+' : ''}
                {data.summary.variancePercent.toFixed(2)}%
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Status</p>
              {Math.abs(data.summary.variancePercent) <= 1 ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-6 w-6" />
                  <span className="text-lg font-bold">Reconciled</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <AlertTriangle className="h-6 w-6" />
                  <span className="text-lg font-bold">Needs Review</span>
                </div>
              )}
            </Card>
          </div>

          {/* Unassigned Projects Warning */}
          {data.unassignedProjects.length > 0 && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4 mr-2" />
              <strong>{data.unassignedProjects.length} project(s)</strong> with costs (
              {formatCurrency(data.unassignedCostTotal)}) are not assigned to any customer.
            </Alert>
          )}

          {/* Invoice Runs */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Invoice Runs</h3>
            {data.invoiceRuns.length === 0 ? (
              <p className="text-muted-foreground">
                No invoice runs for {formatMonth(data.month)}
              </p>
            ) : (
              <div className="space-y-2">
                {data.invoiceRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div>
                      <Badge
                        variant={
                          run.status === 'SUCCEEDED' || run.status === 'LOCKED'
                            ? 'default'
                            : run.status === 'FAILED'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        {run.totalInvoices} invoice{run.totalInvoices !== 1 ? 's' : ''}
                      </p>
                      {run.totalAmount && (
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(parseFloat(run.totalAmount))}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Customer Breakdown */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Customer Breakdown</h3>
            {data.customerBreakdown.length === 0 ? (
              <p className="text-muted-foreground">No customer data available</p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Customer</th>
                      <th className="px-4 py-3 text-right font-medium">Raw Cost</th>
                      <th className="px-4 py-3 text-right font-medium">Invoiced</th>
                      <th className="px-4 py-3 text-right font-medium">Variance</th>
                      <th className="px-4 py-3 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customerBreakdown.map((customer) => {
                      const variancePct =
                        customer.rawCost > 0
                          ? (customer.variance / customer.rawCost) * 100
                          : 0;
                      return (
                        <tr key={customer.customerId} className="border-t">
                          <td className="px-4 py-3 font-medium">
                            {customer.customerName}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCurrency(customer.rawCost)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCurrency(customer.invoicedAmount)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right ${
                              customer.variance >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {customer.variance >= 0 && '+'}
                            {formatCurrency(customer.variance)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {Math.abs(variancePct) <= 1 ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                            ) : variancePct > 0 ? (
                              <TrendingUp className="h-4 w-4 text-orange-500 inline" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-red-500 inline" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Unassigned Projects Details */}
          {data.unassignedProjects.length > 0 && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Unassigned Projects</h3>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Project ID</th>
                      <th className="px-4 py-3 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unassignedProjects.map((project) => (
                      <tr key={project.projectId} className="border-t">
                        <td className="px-4 py-3 font-mono text-xs">
                          {project.projectId}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(project.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
