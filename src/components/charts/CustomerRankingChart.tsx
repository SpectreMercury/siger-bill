'use client';

import dynamic from 'next/dynamic';
import { CustomerRanking } from '@/lib/client/types';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface CustomerRankingChartProps {
  data: CustomerRanking[];
  title?: string;
  height?: string;
}

export function CustomerRankingChart({
  data,
  title = 'Top Customers by Revenue',
  height = '350px',
}: CustomerRankingChartProps) {
  const sortedData = [...data].sort((a, b) => parseFloat(b.totalRevenue) - parseFloat(a.totalRevenue));

  const customerNames = sortedData.map((d) =>
    d.customerName.length > 20 ? d.customerName.substring(0, 20) + '...' : d.customerName
  );
  const revenues = sortedData.map((d) => parseFloat(d.totalRevenue));

  const colors = ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#e0e7ff', '#e5e7eb', '#f3f4f6'];

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
      axisPointer: { type: 'shadow' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any[]) => {
        const item = sortedData[customerNames.indexOf(params[0].name)];
        let result = `<strong>${item?.customerName || params[0].name}</strong><br/>`;
        result += `Revenue: $${params[0].value.toLocaleString()}<br/>`;
        result += `Invoices: ${item?.invoiceCount || 0}<br/>`;
        if (item?.momGrowth) {
          result += `MoM Growth: ${parseFloat(item.momGrowth).toFixed(1)}%`;
        }
        return result;
      },
    },
    grid: {
      left: '3%',
      right: '15%',
      bottom: '3%',
      top: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: '#6b7280',
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    yAxis: {
      type: 'category',
      data: customerNames.reverse(),
      axisLabel: {
        color: '#374151',
        fontSize: 12,
      },
    },
    series: [
      {
        type: 'bar',
        data: revenues.reverse().map((value, index) => ({
          value,
          itemStyle: {
            color: colors[Math.min(index, colors.length - 1)],
            borderRadius: [0, 4, 4, 0],
          },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (params: { value: number }) => `$${params.value.toLocaleString()}`,
          color: '#374151',
          fontSize: 11,
        },
      },
    ],
  };

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[300px] text-gray-400">
          No customer data available
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
