'use client';

import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { TrendDataPoint } from '@/lib/client/dashboard-types';
import { formatMonth, formatCurrency } from '@/lib/dashboard-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { BarChart3 } from 'lucide-react';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface TrendChartProps {
  data: TrendDataPoint[];
  isLoading: boolean;
  title?: string;
}

export function TrendChart({ data, isLoading, title = 'Revenue Trends' }: TrendChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (isLoading) {
    return <ChartSkeleton title={title} />;
  }

  if (!data || data.length === 0) {
    return <EmptyChart title={title} />;
  }

  const months = data.map((d) => formatMonth(d.month));
  const textColor = isDark ? '#e5e5e5' : '#374151';
  const axisLineColor = isDark ? '#404040' : '#e5e7eb';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const option: any = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: '#6a7985',
        },
      },
      backgroundColor: isDark ? '#1f1f1f' : '#fff',
      borderColor: isDark ? '#404040' : '#e5e7eb',
      textStyle: { color: textColor },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any[]) => {
        let tooltip = `<strong>${params[0]?.axisValue || ''}</strong><br/>`;
        params.forEach((param: { seriesName: string; value: number; color: string }) => {
          tooltip += `<span style="color:${param.color}">●</span> ${param.seriesName}: ${formatCurrency(param.value)}<br/>`;
        });
        return tooltip;
      },
    },
    legend: {
      data: ['List Amount', 'Discounts', 'Credits', 'Net Revenue'],
      bottom: 0,
      textStyle: { color: textColor },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: months,
      axisLabel: { fontSize: 11, color: textColor },
      axisLine: { lineStyle: { color: axisLineColor } },
    },
    yAxis: {
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
    series: [
      {
        name: 'List Amount',
        type: 'line',
        stack: 'Total',
        areaStyle: { opacity: 0.3 },
        emphasis: { focus: 'series' },
        data: data.map((d) => parseFloat(d.listAmount || '0')),
        itemStyle: { color: '#3B82F6' },
      },
      {
        name: 'Discounts',
        type: 'line',
        stack: 'Deductions',
        areaStyle: { opacity: 0.3 },
        emphasis: { focus: 'series' },
        data: data.map((d) => parseFloat(d.discountAmount || '0') + parseFloat(d.tierDiscountAmount || '0')),
        itemStyle: { color: '#F97316' },
      },
      {
        name: 'Credits',
        type: 'line',
        stack: 'Deductions',
        areaStyle: { opacity: 0.3 },
        emphasis: { focus: 'series' },
        data: data.map((d) => parseFloat(d.creditAmount || '0')),
        itemStyle: { color: '#A855F7' },
      },
      {
        name: 'Net Revenue',
        type: 'line',
        emphasis: { focus: 'series' },
        data: data.map((d) => parseFloat(d.finalAmount || '0')),
        itemStyle: { color: '#10B981' },
        lineStyle: { width: 3 },
      },
    ],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ReactECharts option={option} style={{ height: '350px' }} />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[350px] w-full" />
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
        <div className="h-[350px] flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
            <p>No data available for selected range</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
