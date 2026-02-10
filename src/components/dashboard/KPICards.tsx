'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardOverviewResponse } from '@/lib/client/dashboard-types';
import { formatCurrency, formatPercent } from '@/lib/dashboard-utils';
import { Card } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DollarSign, Calculator, Tag, Gift, TrendingUp } from 'lucide-react';

interface KPICardsProps {
  data: DashboardOverviewResponse | null;
  isLoading: boolean;
}

export function KPICards({ data, isLoading }: KPICardsProps) {
  const { isSuperAdmin, isAdmin, isFinance } = useAuth();
  const t = useTranslations('dashboard.kpi');
  const canViewMargin = isSuperAdmin || isAdmin || isFinance;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <KPICardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Net Revenue */}
      <KPICard
        title={t('netRevenue')}
        value={data ? formatCurrency(data.totalFinalAmount) : '-'}
        subtitle={t('netRevenueDesc')}
        trend={data?.momGrowth ? { value: parseFloat(data.momGrowth), label: 'vs last period' } : undefined}
        icon={<DollarSign className="h-6 w-6" />}
        iconBgColor="bg-green-100 dark:bg-green-900/30"
        iconColor="text-green-600 dark:text-green-400"
      />

      {/* Total List Amount */}
      <KPICard
        title={t('listAmount')}
        value={data ? formatCurrency(data.totalListAmount) : '-'}
        subtitle={t('listAmountDesc')}
        icon={<Calculator className="h-6 w-6" />}
        iconBgColor="bg-blue-100 dark:bg-blue-900/30"
        iconColor="text-blue-600 dark:text-blue-400"
      />

      {/* Total Discounts */}
      <KPICard
        title={t('discounts')}
        value={data ? formatCurrency(parseFloat(data.totalDiscountAmount || '0') + parseFloat(data.totalTierDiscountAmount || '0')) : '-'}
        subtitle={t('discountsDesc')}
        icon={<Tag className="h-6 w-6" />}
        iconBgColor="bg-orange-100 dark:bg-orange-900/30"
        iconColor="text-orange-600 dark:text-orange-400"
      />

      {/* Credits Burned */}
      <KPICard
        title={t('creditsApplied')}
        value={data ? formatCurrency(data.totalCreditAmount) : '-'}
        subtitle={t('creditsAppliedDesc')}
        icon={<Gift className="h-6 w-6" />}
        iconBgColor="bg-purple-100 dark:bg-purple-900/30"
        iconColor="text-purple-600 dark:text-purple-400"
      />

      {/* Margin (only for finance/admin) */}
      {canViewMargin && (
        <KPICard
          title={t('grossMargin')}
          value={data?.totalGrossMargin ? formatCurrency(data.totalGrossMargin) : '-'}
          subtitle={data?.marginPercent ? `${parseFloat(data.marginPercent).toFixed(1)}% ${t('grossMarginDesc')}` : undefined}
          icon={<TrendingUp className="h-6 w-6" />}
          iconBgColor="bg-emerald-100 dark:bg-emerald-900/30"
          iconColor="text-emerald-600 dark:text-emerald-400"
        />
      )}
    </div>
  );
}

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: {
    value: number;
    label: string;
  };
  icon: React.ReactNode;
  iconBgColor?: string;
  iconColor?: string;
}

function KPICard({ title, value, subtitle, trend, icon, iconBgColor = 'bg-primary/10', iconColor = 'text-primary' }: KPICardProps) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          {trend && (
            <p className={`text-sm mt-2 ${trend.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatPercent(trend.value)} <span className="text-muted-foreground">{trend.label}</span>
            </p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${iconBgColor} ${iconColor}`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

function KPICardSkeleton() {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="w-12 h-12 rounded-lg" />
      </div>
    </Card>
  );
}
