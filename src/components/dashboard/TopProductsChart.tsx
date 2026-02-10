'use client';

import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { ProductItem } from '@/lib/client/dashboard-types';
import { formatCurrency } from '@/lib/dashboard-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { BarChart3 } from 'lucide-react';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface TopProductsChartProps {
  data: ProductItem[];
  isLoading: boolean;
  title?: string;
}

export function TopProductsChart({ data, isLoading, title = 'Top Products' }: TopProductsChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (isLoading) {
    return <ChartSkeleton title={title} />;
  }

  if (!data || data.length === 0) {
    return <EmptyChart title={title} />;
  }

  // Take top 10 and reverse for horizontal bar chart (bottom to top)
  const chartData = data.slice(0, 10).reverse();
  const textColor = isDark ? '#e5e5e5' : '#374151';
  const axisLineColor = isDark ? '#404040' : '#e5e7eb';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const option: any = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: isDark ? '#1f1f1f' : '#fff',
      borderColor: isDark ? '#404040' : '#e5e7eb',
      textStyle: { color: textColor },
      formatter: (params: { name: string; value: number }[]) => {
        const item = params[0];
        const product = chartData.find((d) => d.productGroup === item.name);
        return `<strong>${item.name}</strong><br/>${formatCurrency(item.value)}${product ? ` (${parseFloat(product.percentage).toFixed(1)}%)` : ''}`;
      },
    },
    grid: {
      left: '3%',
      right: '10%',
      bottom: '3%',
      top: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (value: number) => {
          if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
          if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
          return `$${value}`;
        },
        fontSize: 11,
        color: textColor,
      },
      axisLine: { lineStyle: { color: axisLineColor } },
      splitLine: { lineStyle: { color: axisLineColor } },
    },
    yAxis: {
      type: 'category',
      data: chartData.map((d) => d.productGroup),
      axisLabel: { fontSize: 11, width: 120, overflow: 'truncate', color: textColor },
      axisLine: { lineStyle: { color: axisLineColor } },
    },
    series: [
      {
        name: 'Revenue',
        type: 'bar',
        data: chartData.map((d, index) => ({
          value: parseFloat(d.amount),
          itemStyle: {
            color: COLORS[index % COLORS.length],
            borderRadius: [0, 4, 4, 0],
          },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (params: { value: number }) => formatCurrency(params.value),
          fontSize: 10,
          color: textColor,
        },
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

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];

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
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
            <p>No data available</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
