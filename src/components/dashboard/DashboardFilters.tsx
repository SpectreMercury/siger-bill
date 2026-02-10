'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/client/api';
import { getDefaultDateRange, getMonthRange, formatMonth } from '@/lib/dashboard-utils';
import { Customer } from '@/lib/client/types';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Card } from '@/components/ui/shadcn/card';
import { RotateCcw } from 'lucide-react';

const PROVIDERS = ['GCP', 'AWS', 'AZURE', 'OPENAI', 'CUSTOM'];

interface DashboardFiltersProps {
  onFiltersChange?: (filters: {
    from: string;
    to: string;
    provider?: string;
    customerId?: string;
  }) => void;
}

export function DashboardFilters({ onFiltersChange }: DashboardFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSuperAdmin, isAdmin, scopedCustomerIds } = useAuth();
  const t = useTranslations('common');

  const defaultRange = getDefaultDateRange();

  const [from, setFrom] = useState(searchParams.get('from') || defaultRange.from);
  const [to, setTo] = useState(searchParams.get('to') || defaultRange.to);
  const [provider, setProvider] = useState(searchParams.get('provider') || '');
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') || '');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  // Check if user can select customers (internal users with multi-customer access)
  const canSelectCustomer = isSuperAdmin || isAdmin || scopedCustomerIds.length > 1;
  const isCustomerUser = scopedCustomerIds.length === 1 && !isSuperAdmin && !isAdmin;

  // Fetch customers for the dropdown
  useEffect(() => {
    if (!canSelectCustomer) {
      // Customer user - lock to their scoped customer
      if (isCustomerUser && scopedCustomerIds[0]) {
        setCustomerId(scopedCustomerIds[0]);
      }
      return;
    }

    async function fetchCustomers() {
      setIsLoadingCustomers(true);
      try {
        const response = await api.get<{ data: Customer[] }>('/customers?limit=100');
        setCustomers(response.data || []);
      } catch (err) {
        console.error('Error fetching customers:', err);
      } finally {
        setIsLoadingCustomers(false);
      }
    }

    fetchCustomers();
  }, [canSelectCustomer, isCustomerUser, scopedCustomerIds]);

  // Generate month options
  const monthOptions = getMonthRange('2024-01', getDefaultDateRange().to);

  // Update URL and notify parent when filters change
  const applyFilters = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (provider) params.set('provider', provider);
    if (customerId) params.set('customerId', customerId);

    router.push(`/dashboard?${params.toString()}`, { scroll: false });

    onFiltersChange?.({
      from,
      to,
      provider: provider || undefined,
      customerId: customerId || undefined,
    });
  }, [from, to, provider, customerId, router, onFiltersChange]);

  // Apply filters on mount and when values change
  useEffect(() => {
    applyFilters();
  }, [from, to, provider, customerId, applyFilters]);

  const handleReset = () => {
    const range = getDefaultDateRange();
    setFrom(range.from);
    setTo(range.to);
    setProvider('');
    if (!isCustomerUser) setCustomerId('');
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-4">
        {/* From Month */}
        <div className="space-y-1.5">
          <Label htmlFor="from">{t('from')}</Label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t('selectMonth')} />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((month) => (
                <SelectItem key={month} value={month}>
                  {formatMonth(month)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* To Month */}
        <div className="space-y-1.5">
          <Label htmlFor="to">{t('to')}</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t('selectMonth')} />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((month) => (
                <SelectItem key={month} value={month}>
                  {formatMonth(month)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Provider Filter */}
        <div className="space-y-1.5">
          <Label htmlFor="provider">{t('provider')}</Label>
          <Select value={provider || 'all'} onValueChange={(v) => setProvider(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t('provider')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allProviders')}</SelectItem>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Customer Filter (only for internal users) */}
        {canSelectCustomer && (
          <div className="space-y-1.5">
            <Label htmlFor="customerId">{t('customer')}</Label>
            <Select
              value={customerId || 'all'}
              onValueChange={(v) => setCustomerId(v === 'all' ? '' : v)}
              disabled={isLoadingCustomers}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t('selectCustomer')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allCustomers')}</SelectItem>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Reset Button */}
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-1" />
          {t('reset')}
        </Button>
      </div>
    </Card>
  );
}
