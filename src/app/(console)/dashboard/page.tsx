'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client/api';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultDateRange } from '@/lib/dashboard-utils';
import {
  DashboardOverviewResponse,
  TrendDataPoint,
  ProviderMixItem,
  ProductItem,
  CustomerRankingItem,
} from '@/lib/client/dashboard-types';
import {
  DashboardFilters,
  KPICards,
  TrendChart,
  ProviderMixChart,
  TopProductsChart,
  TopCustomersTable,
  RecentImportsWidget,
  RecentInvoiceRunsWidget,
  SystemAlertsWidget,
} from '@/components/dashboard';
import { Alert } from '@/components/ui';
import { Loader2 } from 'lucide-react';

function DashboardContent() {
  const searchParams = useSearchParams();
  const { isLoading: authLoading, isSuperAdmin, isAdmin, isFinance } = useAuth();
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');

  const defaultRange = getDefaultDateRange();

  // Get filters from URL or defaults
  const from = searchParams.get('from') || defaultRange.from;
  const to = searchParams.get('to') || defaultRange.to;
  const provider = searchParams.get('provider') || '';
  const customerId = searchParams.get('customerId') || '';

  // State for API data
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [trends, setTrends] = useState<TrendDataPoint[]>([]);
  const [providerMix, setProviderMix] = useState<ProviderMixItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [customers, setCustomers] = useState<CustomerRankingItem[]>([]);

  const canViewCustomers = isSuperAdmin || isAdmin || isFinance;

  // Fetch dashboard data
  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Build query params
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (provider) params.set('provider', provider);
      if (customerId) params.set('customerId', customerId);

      const queryString = params.toString();

      // Fetch all data in parallel
      const requests: Promise<unknown>[] = [
        api.get<DashboardOverviewResponse>(`/dashboard/overview?${queryString}`),
        api.get<{ data: TrendDataPoint[] }>(`/dashboard/trends?${queryString}`),
        api.get<{ data: ProviderMixItem[] }>(`/dashboard/providers?${queryString}`),
        api.get<{ data: ProductItem[] }>(`/dashboard/products?${queryString}`),
      ];

      // Only fetch customers for internal users
      if (canViewCustomers) {
        requests.push(api.get<{ data: CustomerRankingItem[] }>(`/dashboard/customers?${queryString}&limit=10`));
      }

      const results = await Promise.all(requests);

      setOverview(results[0] as DashboardOverviewResponse);
      setTrends((results[1] as { data: TrendDataPoint[] }).data || []);
      setProviderMix((results[2] as { data: ProviderMixItem[] }).data || []);
      setProducts((results[3] as { data: ProductItem[] }).data || []);

      if (canViewCustomers && results[4]) {
        setCustomers((results[4] as { data: CustomerRankingItem[] }).data || []);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [from, to, provider, customerId, canViewCustomers]);

  // Fetch data when filters change
  useEffect(() => {
    if (!authLoading) {
      fetchDashboardData();
    }
  }, [authLoading, fetchDashboardData]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mx-auto" />
          <p className="mt-4 text-muted-foreground">{tc('loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {/* Filters */}
      <DashboardFilters />

      {/* Error Alert */}
      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
          <button
            onClick={fetchDashboardData}
            className="ml-4 text-sm underline hover:no-underline"
          >
            {tc('retry')}
          </button>
        </Alert>
      )}

      {/* KPI Cards */}
      <KPICards data={overview} isLoading={isLoading} />

      {/* Trends Chart */}
      <TrendChart data={trends} isLoading={isLoading} title={t('revenueTrends')} />

      {/* Lower Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProviderMixChart data={providerMix} isLoading={isLoading} title={t('revenueByProvider')} />
        <TopProductsChart data={products} isLoading={isLoading} title={t('topProductGroups')} />
      </div>

      {/* Top Customers (internal only) */}
      {canViewCustomers && (
        <TopCustomersTable data={customers} isLoading={isLoading} title={t('topCustomers')} />
      )}

      {/* Activity Widgets (internal only) */}
      {canViewCustomers && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <RecentImportsWidget />
          <RecentInvoiceRunsWidget />
          <SystemAlertsWidget />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && overview && parseFloat(overview.totalFinalAmount || '0') === 0 && (
        <Alert variant="info" title={t('noDataTitle')}>
          {t('noDataDescription')}
        </Alert>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
