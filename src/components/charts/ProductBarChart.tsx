'use client';

import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface ProductItem {
  productGroup: string;
  amount: string;
  percentage: string;
}

interface ProductBarChartProps {
  data: ProductItem[];
  title?: string;
  height?: string;
}

const PRODUCT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#84cc16',
  '#06b6d4',
];

export function ProductBarChart({ data, title = 'Top Products', height = '300px' }: ProductBarChartProps) {
  const productNames = data.map((d) =>
    d.productGroup.length > 25 ? d.productGroup.substring(0, 25) + '...' : d.productGroup
  );
  const amounts = data.map((d) => parseFloat(d.amount));

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
        const item = data[productNames.indexOf(params[0].name)];
        return `<strong>${item?.productGroup || params[0].name}</strong><br/>Revenue: $${params[0].value.toLocaleString()}<br/>Share: ${item?.percentage || 0}%`;
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: productNames,
      axisLabel: {
        color: '#6b7280',
        rotate: 30,
        fontSize: 11,
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
        type: 'bar',
        data: amounts.map((value, index) => ({
          value,
          itemStyle: {
            color: PRODUCT_COLORS[index % PRODUCT_COLORS.length],
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barWidth: '60%',
      },
    ],
  };

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[250px] text-gray-400">
          No product data available
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
