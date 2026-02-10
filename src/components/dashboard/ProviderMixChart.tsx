'use client';

import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { ProviderMixItem } from '@/lib/client/dashboard-types';
import { formatCurrency } from '@/lib/dashboard-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { PieChart } from 'lucide-react';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface ProviderMixChartProps {
  data: ProviderMixItem[];
  isLoading: boolean;
  title?: string;
}

export function ProviderMixChart({ data, isLoading, title = 'Revenue by Provider' }: ProviderMixChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (isLoading) {
    return <ChartSkeleton title={title} />;
  }

  if (!data || data.length === 0) {
    return <EmptyChart title={title} />;
  }

  const textColor = isDark ? '#e5e5e5' : '#374151';
  const borderColor = isDark ? '#1f1f1f' : '#fff';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const option: any = {
    tooltip: {
      trigger: 'item',
      backgroundColor: isDark ? '#1f1f1f' : '#fff',
      borderColor: isDark ? '#404040' : '#e5e7eb',
      textStyle: { color: textColor },
      formatter: (params: { name: string; value: number; percent: number }) => {
        return `<strong>${params.name}</strong><br/>${formatCurrency(params.value)} (${params.percent.toFixed(1)}%)`;
      },
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: { color: textColor },
      formatter: (name: string) => {
        const item = data.find((d) => d.provider === name);
        return item ? `${name}: ${parseFloat(item.percentage).toFixed(1)}%` : name;
      },
    },
    series: [
      {
        name: 'Provider',
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 8,
          borderColor: borderColor,
          borderWidth: 2,
        },
        label: {
          show: false,
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold',
            color: textColor,
          },
        },
        labelLine: {
          show: false,
        },
        data: data.map((item, index) => ({
          value: parseFloat(item.amount),
          name: item.provider,
          itemStyle: {
            color: COLORS[index % COLORS.length],
          },
        })),
      },
    ],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ReactECharts option={option} style={{ height: '300px' }} />
      </CardContent>
    </Card>
  );
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function ChartSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full" />
      </CardContent>
    </Card>
  );
}

function EmptyChart({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <PieChart className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
            <p>No data available</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
