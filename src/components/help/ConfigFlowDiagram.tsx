'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

interface FlowNode {
  id: string;
  x: number;
  y: number;
  labelKey: string;
  href: string;
  color: string;
}

interface FlowArrow {
  from: string;
  to: string;
}

export function ConfigFlowDiagram() {
  const t = useTranslations('help.flowDiagram');

  // Node definitions — Row 0 is GCP setup, rows 1-7 are the billing workflow
  const nodes: FlowNode[] = [
    // Row 0 - System Setup
    { id: 'gcpConnections', x: 400, y: 60, labelKey: 'gcpConnections', href: '/admin/gcp-connections', color: '#6b7280' },

    // Row 1 - Foundation
    { id: 'customers', x: 400, y: 160, labelKey: 'customers', href: '/admin/customers', color: '#3b82f6' },

    // Row 2 - Infrastructure
    { id: 'billingAccounts', x: 200, y: 260, labelKey: 'billingAccounts', href: '/admin/billing-accounts', color: '#8b5cf6' },
    { id: 'pricingLists', x: 600, y: 260, labelKey: 'pricingLists', href: '/admin/pricing-lists', color: '#f59e0b' },

    // Row 3 - Resources
    { id: 'projects', x: 200, y: 360, labelKey: 'projects', href: '/admin/projects', color: '#8b5cf6' },
    { id: 'productGroups', x: 400, y: 360, labelKey: 'productGroups', href: '/admin/sku-groups', color: '#10b981' },
    { id: 'credits', x: 600, y: 360, labelKey: 'credits', href: '/admin/credits', color: '#f59e0b' },

    // Row 4 - Data Input
    { id: 'costImports', x: 300, y: 460, labelKey: 'costImports', href: '/admin/raw-cost-imports', color: '#6366f1' },

    // Row 5 - Processing
    { id: 'invoiceRuns', x: 400, y: 560, labelKey: 'invoiceRuns', href: '/admin/invoice-runs', color: '#ec4899' },

    // Row 6 - Output
    { id: 'invoices', x: 300, y: 660, labelKey: 'invoices', href: '/invoices', color: '#ef4444' },
    { id: 'reconciliation', x: 500, y: 660, labelKey: 'reconciliation', href: '/admin/reconciliation', color: '#14b8a6' },

    // Row 7 - Final
    { id: 'payments', x: 300, y: 760, labelKey: 'payments', href: '/admin/payments', color: '#22c55e' },
  ];

  // Arrow definitions
  const arrows: FlowArrow[] = [
    // GCP connections feeds into billing account setup and project info
    { from: 'gcpConnections', to: 'billingAccounts' },
    { from: 'gcpConnections', to: 'projects' },

    // Customer connections
    { from: 'customers', to: 'billingAccounts' },
    { from: 'customers', to: 'pricingLists' },
    { from: 'customers', to: 'credits' },

    // Billing account connections
    { from: 'billingAccounts', to: 'projects' },

    // Project connections
    { from: 'projects', to: 'costImports' },

    // Product groups connections
    { from: 'productGroups', to: 'costImports' },
    { from: 'productGroups', to: 'invoiceRuns' },

    // Pricing connections
    { from: 'pricingLists', to: 'invoiceRuns' },
    { from: 'credits', to: 'invoiceRuns' },

    // Cost imports connections
    { from: 'costImports', to: 'invoiceRuns' },

    // Invoice runs connections
    { from: 'invoiceRuns', to: 'invoices' },
    { from: 'invoiceRuns', to: 'reconciliation' },

    // Invoice connections
    { from: 'invoices', to: 'payments' },
  ];

  const getNode = (id: string) => nodes.find(n => n.id === id);

  const getArrowPath = (from: FlowNode, to: FlowNode) => {
    const nodeWidth = 140;
    const nodeHeight = 40;

    let startX = from.x;
    let startY = from.y + nodeHeight / 2;
    let endX = to.x;
    let endY = to.y - nodeHeight / 2;

    if (Math.abs(from.y - to.y) < 50) {
      if (from.x < to.x) {
        startX = from.x + nodeWidth / 2;
        endX = to.x - nodeWidth / 2;
      } else {
        startX = from.x - nodeWidth / 2;
        endX = to.x + nodeWidth / 2;
      }
      startY = from.y;
      endY = to.y;
    }

    const midY = (startY + endY) / 2;
    return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[800px]">
        {/* Legend */}
        <div className="flex flex-wrap gap-4 mb-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gray-500" />
            <span className="text-muted-foreground">{t('legend.system')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span className="text-muted-foreground">{t('legend.customer')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-violet-500" />
            <span className="text-muted-foreground">{t('legend.infrastructure')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-500" />
            <span className="text-muted-foreground">{t('legend.pricing')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span className="text-muted-foreground">{t('legend.catalog')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-indigo-500" />
            <span className="text-muted-foreground">{t('legend.data')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-pink-500" />
            <span className="text-muted-foreground">{t('legend.processing')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span className="text-muted-foreground">{t('legend.output')}</span>
          </div>
        </div>

        <svg
          viewBox="0 0 800 820"
          className="w-full h-auto"
          style={{ maxHeight: '800px' }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                className="fill-muted-foreground/50"
              />
            </marker>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1" />
            </filter>
          </defs>

          {/* Draw arrows first (behind nodes) */}
          {arrows.map((arrow, index) => {
            const from = getNode(arrow.from);
            const to = getNode(arrow.to);
            if (!from || !to) return null;

            return (
              <path
                key={index}
                d={getArrowPath(from, to)}
                fill="none"
                className="stroke-muted-foreground/30"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
            );
          })}

          {/* Draw nodes */}
          {nodes.map((node) => (
            <Link key={node.id} href={node.href}>
              <g className="cursor-pointer group">
                <rect
                  x={node.x - 70}
                  y={node.y - 20}
                  width="140"
                  height="40"
                  rx="8"
                  fill={node.color}
                  filter="url(#shadow)"
                  className="transition-all duration-200 group-hover:opacity-90"
                />
                <rect
                  x={node.x - 70}
                  y={node.y - 20}
                  width="140"
                  height="40"
                  rx="8"
                  fill="none"
                  stroke="white"
                  strokeWidth="0"
                  className="transition-all duration-200 group-hover:stroke-[2]"
                />
                <text
                  x={node.x}
                  y={node.y + 5}
                  textAnchor="middle"
                  className="fill-white text-xs font-medium pointer-events-none"
                  style={{ fontSize: '12px' }}
                >
                  {t(`nodes.${node.id}`)}
                </text>
              </g>
            </Link>
          ))}

          {/* Phase labels */}
          <text x="50" y="65" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.system')}
          </text>
          <text x="50" y="165" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.foundation')}
          </text>
          <text x="50" y="265" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.setup')}
          </text>
          <text x="50" y="365" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.config')}
          </text>
          <text x="50" y="465" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.import')}
          </text>
          <text x="50" y="565" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.generate')}
          </text>
          <text x="50" y="665" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.review')}
          </text>
          <text x="50" y="765" className="fill-muted-foreground text-[10px] font-medium" style={{ fontSize: '10px', fill: '#9ca3af' }}>
            {t('phases.collect')}
          </text>

          {/* Phase divider lines */}
          {[110, 210, 310, 410, 510, 610, 710].map((y, i) => (
            <line
              key={i}
              x1="40"
              y1={y}
              x2="760"
              y2={y}
              className="stroke-muted-foreground/10"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          ))}
        </svg>

        {/* Flow description */}
        <div className="mt-4 p-4 bg-muted/30 rounded-lg">
          <h4 className="text-sm font-medium mb-2">{t('description.title')}</h4>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>{t('description.step1')}</li>
            <li>{t('description.step2')}</li>
            <li>{t('description.step3')}</li>
            <li>{t('description.step4')}</li>
            <li>{t('description.step5')}</li>
            <li>{t('description.step6')}</li>
            <li>{t('description.step7')}</li>
            <li>{t('description.step8')}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
