'use client';

import { useMemo, useState } from 'react';
import { InvoiceLineItem } from '@/lib/client/invoice-types';
import { formatCurrency } from '@/lib/invoice-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { ChevronRight, FileSpreadsheet } from 'lucide-react';

interface InvoiceBreakdownTableProps {
  lineItems: InvoiceLineItem[];
  currency: string;
}

type GroupBy = 'productGroup' | 'provider' | 'skuGroup' | 'none';

interface AggregatedRow {
  key: string;
  label: string;
  itemCount: number;
  quantity: number;
  listAmount: number;
  discountAmount: number;
  tierDiscountAmount: number;
  creditAmount: number;
  amount: number;
}

export function InvoiceBreakdownTable({ lineItems, currency }: InvoiceBreakdownTableProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('productGroup');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const aggregatedData = useMemo(() => {
    if (groupBy === 'none' || !lineItems?.length) {
      return null;
    }

    const groups = new Map<string, AggregatedRow>();

    lineItems.forEach((item) => {
      let key: string;
      let label: string;

      switch (groupBy) {
        case 'productGroup':
          key = item.productGroup || 'Other';
          label = item.productGroup || 'Other';
          break;
        case 'provider':
          key = item.provider || 'Unknown';
          label = item.provider || 'Unknown Provider';
          break;
        case 'skuGroup':
          key = item.skuGroupCode || 'Ungrouped';
          label = item.skuGroupCode || 'Ungrouped SKUs';
          break;
        default:
          key = 'all';
          label = 'All Items';
      }

      const existing = groups.get(key) || {
        key,
        label,
        itemCount: 0,
        quantity: 0,
        listAmount: 0,
        discountAmount: 0,
        tierDiscountAmount: 0,
        creditAmount: 0,
        amount: 0,
      };

      existing.itemCount += 1;
      existing.quantity += parseFloat(item.quantity) || 0;
      existing.listAmount += parseFloat(item.listAmount) || 0;
      existing.discountAmount += parseFloat(item.discountAmount) || 0;
      existing.tierDiscountAmount += parseFloat(item.tierDiscountAmount) || 0;
      existing.creditAmount += parseFloat(item.creditAmount) || 0;
      existing.amount += parseFloat(item.amount) || 0;

      groups.set(key, existing);
    });

    return Array.from(groups.values()).sort((a, b) => b.amount - a.amount);
  }, [lineItems, groupBy]);

  const totals = useMemo(() => {
    if (!lineItems?.length) return null;

    return lineItems.reduce(
      (acc, item) => ({
        quantity: acc.quantity + (parseFloat(item.quantity) || 0),
        listAmount: acc.listAmount + (parseFloat(item.listAmount) || 0),
        discountAmount: acc.discountAmount + (parseFloat(item.discountAmount) || 0),
        tierDiscountAmount: acc.tierDiscountAmount + (parseFloat(item.tierDiscountAmount) || 0),
        creditAmount: acc.creditAmount + (parseFloat(item.creditAmount) || 0),
        amount: acc.amount + (parseFloat(item.amount) || 0),
      }),
      {
        quantity: 0,
        listAmount: 0,
        discountAmount: 0,
        tierDiscountAmount: 0,
        creditAmount: 0,
        amount: 0,
      }
    );
  }, [lineItems]);

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getItemsForGroup = (groupKey: string) => {
    return lineItems.filter((item) => {
      switch (groupBy) {
        case 'productGroup':
          return (item.productGroup || 'Other') === groupKey;
        case 'provider':
          return (item.provider || 'Unknown') === groupKey;
        case 'skuGroup':
          return (item.skuGroupCode || 'Ungrouped') === groupKey;
        default:
          return true;
      }
    });
  };

  if (!lineItems?.length) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
        No line items to display
      </Card>
    );
  }

  return (
    <Card>
      {/* Header with Group By selector */}
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Cost Breakdown</CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="groupBy" className="text-sm">
            Group by:
          </Label>
          <Select
            value={groupBy}
            onValueChange={(value) => {
              setGroupBy(value as GroupBy);
              setExpandedRows(new Set());
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="productGroup">Product Group</SelectItem>
              <SelectItem value="provider">Provider</SelectItem>
              <SelectItem value="skuGroup">SKU Group</SelectItem>
              <SelectItem value="none">No Grouping (All Items)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      {/* Table */}
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{groupBy === 'none' ? '#' : 'Group'}</TableHead>
              <TableHead>{groupBy === 'none' ? 'Description' : 'Items'}</TableHead>
              <TableHead className="text-right">List Amount</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Tier Discount</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Net Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupBy === 'none' ? (
              // Show all items without grouping
              lineItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground">{item.lineNumber}</TableCell>
                  <TableCell className="max-w-md">
                    <div className="truncate">{item.description}</div>
                    {item.skuGroupCode && (
                      <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        {item.skuGroupCode}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(item.listAmount, currency)}
                  </TableCell>
                  <TableCell className="text-right text-orange-600 dark:text-orange-400">
                    {parseFloat(item.discountAmount) > 0
                      ? `-${formatCurrency(item.discountAmount, currency)}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right text-orange-600 dark:text-orange-400">
                    {parseFloat(item.tierDiscountAmount) > 0
                      ? `-${formatCurrency(item.tierDiscountAmount, currency)}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right text-purple-600 dark:text-purple-400">
                    {parseFloat(item.creditAmount) > 0
                      ? `-${formatCurrency(item.creditAmount, currency)}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(item.amount, currency)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              // Show aggregated rows
              aggregatedData?.map((row) => (
                <>
                  <TableRow
                    key={row.key}
                    className="cursor-pointer"
                    onClick={() => toggleRow(row.key)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          className={`h-4 w-4 text-muted-foreground transition-transform ${
                            expandedRows.has(row.key) ? 'rotate-90' : ''
                          }`}
                        />
                        <span className="font-medium">{row.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.itemCount} items</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.listAmount, currency)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600 dark:text-orange-400">
                      {row.discountAmount > 0
                        ? `-${formatCurrency(row.discountAmount, currency)}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right text-orange-600 dark:text-orange-400">
                      {row.tierDiscountAmount > 0
                        ? `-${formatCurrency(row.tierDiscountAmount, currency)}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right text-purple-600 dark:text-purple-400">
                      {row.creditAmount > 0
                        ? `-${formatCurrency(row.creditAmount, currency)}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(row.amount, currency)}
                    </TableCell>
                  </TableRow>
                  {/* Expanded detail rows */}
                  {expandedRows.has(row.key) &&
                    getItemsForGroup(row.key).map((item) => (
                      <TableRow key={item.id} className="bg-muted/50">
                        <TableCell className="pl-10 text-xs text-muted-foreground">{item.lineNumber}</TableCell>
                        <TableCell className="text-xs max-w-md">
                          <div className="truncate">{item.description}</div>
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {formatCurrency(item.listAmount, currency)}
                        </TableCell>
                        <TableCell className="text-xs text-right text-orange-500 dark:text-orange-400">
                          {parseFloat(item.discountAmount) > 0
                            ? `-${formatCurrency(item.discountAmount, currency)}`
                            : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-right text-orange-500 dark:text-orange-400">
                          {parseFloat(item.tierDiscountAmount) > 0
                            ? `-${formatCurrency(item.tierDiscountAmount, currency)}`
                            : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-right text-purple-500 dark:text-purple-400">
                          {parseFloat(item.creditAmount) > 0
                            ? `-${formatCurrency(item.creditAmount, currency)}`
                            : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {formatCurrency(item.amount, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                </>
              ))
            )}
          </TableBody>
          {/* Footer totals */}
          {totals && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>
                  Total ({lineItems.length} items)
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(totals.listAmount, currency)}
                </TableCell>
                <TableCell className="text-right text-orange-700 dark:text-orange-400">
                  {totals.discountAmount > 0
                    ? `-${formatCurrency(totals.discountAmount, currency)}`
                    : '-'}
                </TableCell>
                <TableCell className="text-right text-orange-700 dark:text-orange-400">
                  {totals.tierDiscountAmount > 0
                    ? `-${formatCurrency(totals.tierDiscountAmount, currency)}`
                    : '-'}
                </TableCell>
                <TableCell className="text-right text-purple-700 dark:text-purple-400">
                  {totals.creditAmount > 0
                    ? `-${formatCurrency(totals.creditAmount, currency)}`
                    : '-'}
                </TableCell>
                <TableCell className="text-right font-bold">
                  {formatCurrency(totals.amount, currency)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}
