'use client';

import dynamic from 'next/dynamic';
import { TrendDataPoint } from '@/lib/client/types';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface TrendChartProps {
  data: TrendDataPoint[];
  title?: string;
  height?: string;
}

export function TrendChart({ data, title = 'Revenue Trends', height = '350px' }: TrendChartProps) {
  const months = data.map((d) => d.month);
  const revenues = data.map((d) => parseFloat(d.totalRevenue));
  const discounts = data.map((d) => parseFloat(d.totalDiscount));
  const credits = data.map((d) => parseFloat(d.totalCredits));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const option: any = {
    title: {
      text: title,
      left: 'left',
      textStyle: {
        fontSize: 16,
        fontWeight: 600,
        color: '#111827',
      },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any[]) => {
        let result = `<strong>${params[0].axisValue}</strong><br/>`;
        params.forEach((item) => {
          result += `${item.marker} ${item.seriesName}: $${item.value.toLocaleString()}<br/>`;
        });
        return result;
      },
    },
    legend: {
      data: ['Revenue', 'Discounts', 'Credits'],
      bottom: 0,
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: months,
      axisLabel: {
        color: '#6b7280',
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#6b7280',
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    series: [
      {
        name: 'Revenue',
        type: 'line',
        areaStyle: { opacity: 0.4 },
        emphasis: { focus: 'series' },
        data: revenues,
        itemStyle: { color: '#3b82f6' },
      },
      {
        name: 'Discounts',
        type: 'line',
        areaStyle: { opacity: 0.4 },
        emphasis: { focus: 'series' },
        data: discounts,
        itemStyle: { color: '#f59e0b' },
      },
      {
        name: 'Credits',
        type: 'line',
        areaStyle: { opacity: 0.4 },
        emphasis: { focus: 'series' },
        data: credits,
        itemStyle: { color: '#10b981' },
      },
    ],
  };

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[300px] text-gray-400">
          No trend data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
      <ReactECharts option={option} style={{ height }} />
    </div>
  );
}
