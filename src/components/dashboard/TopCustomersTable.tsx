'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerRankingItem } from '@/lib/client/dashboard-types';
import { formatCurrency, formatPercent } from '@/lib/dashboard-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Users } from 'lucide-react';

interface TopCustomersTableProps {
  data: CustomerRankingItem[];
  isLoading: boolean;
  title?: string;
}

export function TopCustomersTable({ data, isLoading, title }: TopCustomersTableProps) {
  const { isSuperAdmin, isAdmin, isFinance } = useAuth();
  const t = useTranslations('dashboard.table');
  const displayTitle = title || t('customer');

  // Only show for internal users
  if (!isSuperAdmin && !isAdmin && !isFinance) {
    return null;
  }

  if (isLoading) {
    return <TableSkeleton title={displayTitle} />;
  }

  if (!data || data.length === 0) {
    return <EmptyTable title={displayTitle} noDataText={t('noCustomerData')} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{displayTitle}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{t('rank')}</TableHead>
              <TableHead>{t('customer')}</TableHead>
              <TableHead className="text-right">{t('revenue')}</TableHead>
              <TableHead className="text-right">{t('growth')}</TableHead>
              <TableHead className="text-right">{t('invoices')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((customer) => (
              <TableRow key={customer.customerId}>
                <TableCell>
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                    customer.rank === 1
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                      : customer.rank === 2
                      ? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                      : customer.rank === 3
                      ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {customer.rank}
                  </span>
                </TableCell>
                <TableCell>
                  <div>
                    <div className="font-medium">{customer.customerName}</div>
                    {customer.externalId && (
                      <div className="text-xs text-muted-foreground">{customer.externalId}</div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(customer.totalRevenue)}
                </TableCell>
                <TableCell className="text-right">
                  {customer.momGrowth ? (
                    <span className={`${parseFloat(customer.momGrowth) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatPercent(customer.momGrowth)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {customer.invoiceCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TableSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="w-6 h-6 rounded-full" />
              <Skeleton className="flex-1 h-4" />
              <Skeleton className="w-20 h-4" />
              <Skeleton className="w-16 h-4" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyTable({ title, noDataText }: { title: string; noDataText: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="py-12 text-center text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
          <p>{noDataText}</p>
        </div>
      </CardContent>
    </Card>
  );
}
