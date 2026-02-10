'use client';

import { formatCurrency } from '@/lib/invoice-utils';
import { Card } from '@/components/ui/shadcn/card';

interface InvoiceSummaryCardsProps {
  listAmount: string;
  discountAmount: string;
  tierDiscountAmount: string;
  creditAmount: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
}

export function InvoiceSummaryCards({
  listAmount,
  discountAmount,
  tierDiscountAmount,
  creditAmount,
  subtotal,
  taxAmount,
  totalAmount,
  currency,
}: InvoiceSummaryCardsProps) {
  const list = parseFloat(listAmount) || 0;
  const discount = parseFloat(discountAmount) || 0;
  const tierDiscount = parseFloat(tierDiscountAmount) || 0;
  const credit = parseFloat(creditAmount) || 0;
  const sub = parseFloat(subtotal) || 0;
  const tax = parseFloat(taxAmount) || 0;
  const total = parseFloat(totalAmount) || 0;

  const totalDiscounts = discount + tierDiscount;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
      <SummaryCard
        label="List Amount"
        value={formatCurrency(list, currency)}
        color="blue"
      />
      <SummaryCard
        label="Discounts"
        value={`-${formatCurrency(totalDiscounts, currency)}`}
        subValue={tierDiscount > 0 ? `(Tier: ${formatCurrency(tierDiscount, currency)})` : undefined}
        color="orange"
      />
      <SummaryCard
        label="Credits"
        value={`-${formatCurrency(credit, currency)}`}
        color="purple"
      />
      <SummaryCard
        label="Subtotal"
        value={formatCurrency(sub, currency)}
        color="gray"
      />
      <SummaryCard
        label="Tax"
        value={formatCurrency(tax, currency)}
        color="gray"
      />
      <SummaryCard
        label="Total"
        value={formatCurrency(total, currency)}
        color="green"
        highlight
      />
      <SummaryCard
        label="Savings"
        value={formatCurrency(totalDiscounts + credit, currency)}
        subValue={list > 0 ? `${((totalDiscounts + credit) / list * 100).toFixed(1)}%` : undefined}
        color="emerald"
      />
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  subValue?: string;
  color: 'blue' | 'orange' | 'purple' | 'green' | 'gray' | 'emerald';
  highlight?: boolean;
}

function SummaryCard({ label, value, subValue, color, highlight }: SummaryCardProps) {
  const colorClasses = {
    blue: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20',
    orange: 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20',
    purple: 'border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20',
    green: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20',
    gray: 'border-border bg-muted',
    emerald: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20',
  };

  const valueColorClasses = {
    blue: 'text-blue-700 dark:text-blue-400',
    orange: 'text-orange-700 dark:text-orange-400',
    purple: 'text-purple-700 dark:text-purple-400',
    green: 'text-green-700 dark:text-green-400',
    gray: 'text-foreground',
    emerald: 'text-emerald-700 dark:text-emerald-400',
  };

  return (
    <div
      className={`rounded-lg border p-4 ${colorClasses[color]} ${
        highlight ? 'ring-2 ring-green-400 ring-offset-2 dark:ring-offset-background' : ''
      }`}
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-1 ${valueColorClasses[color]}`}>{value}</p>
      {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
    </div>
  );
}

// Compact version for list pages
interface CompactSummaryProps {
  invoiceCount: number;
  totalAmount: string;
  currency: string;
  statusCounts: {
    draft: number;
    issued: number;
    paid: number;
    locked: number;
    cancelled: number;
  };
}

export function CompactInvoiceSummary({
  invoiceCount,
  totalAmount,
  currency,
  statusCounts,
}: CompactSummaryProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
      <Card className="p-4">
        <p className="text-xs font-medium text-muted-foreground">Total Invoices</p>
        <p className="text-2xl font-bold">{invoiceCount}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs font-medium text-muted-foreground">Total Amount</p>
        <p className="text-2xl font-bold">{formatCurrency(totalAmount, currency)}</p>
      </Card>
      <div className="p-4 rounded-lg border bg-muted">
        <p className="text-xs font-medium text-muted-foreground">Draft</p>
        <p className="text-xl font-bold text-muted-foreground">{statusCounts.draft}</p>
      </div>
      <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
        <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Issued</p>
        <p className="text-xl font-bold text-blue-700 dark:text-blue-400">{statusCounts.issued}</p>
      </div>
      <div className="p-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20">
        <p className="text-xs font-medium text-green-600 dark:text-green-400">Paid</p>
        <p className="text-xl font-bold text-green-700 dark:text-green-400">{statusCounts.paid}</p>
      </div>
      <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Locked</p>
        <p className="text-xl font-bold text-amber-700 dark:text-amber-400">{statusCounts.locked}</p>
      </div>
    </div>
  );
}
