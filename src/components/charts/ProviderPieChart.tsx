'use client';

import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface ProviderMixItem {
  provider: string;
  amount: string;
  percentage: string;
}

interface ProviderPieChartProps {
  data: ProviderMixItem[];
  title?: string;
  height?: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  AWS: '#ff9900',
  GCP: '#4285f4',
  AZURE: '#0078d4',
  OPENAI: '#00a67e',
  CUSTOM: '#6b7280',
  OTHER: '#9ca3af',
};

export function ProviderPieChart({
  data,
  title = 'Revenue by Provider',
  height = '300px',
}: ProviderPieChartProps) {
  const chartData = data.map((item) => ({
    name: item.provider,
    value: parseFloat(item.amount),
  }));

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
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        return `<strong>${params.name}</strong><br/>Revenue: $${params.value.toLocaleString()}<br/>Share: ${params.percent.toFixed(1)}%`;
      },
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'middle',
      textStyle: { color: '#374151' },
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['35%', '55%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: { show: false },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold',
          },
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
        labelLine: { show: false },
        data: chartData.map((item) => ({
          ...item,
          itemStyle: { color: PROVIDER_COLORS[item.name] || '#6b7280' },
        })),
      },
    ],
  };

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[250px] text-gray-400">
          No provider data available
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
