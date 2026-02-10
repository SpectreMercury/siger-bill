'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/client/api';
import { InvoiceStatus, InvoiceFilters } from '@/lib/client/invoice-types';
import { Customer } from '@/lib/client/types';
import { getCurrentMonth, formatMonth } from '@/lib/invoice-utils';
import { getMonthRange } from '@/lib/dashboard-utils';
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

const STATUSES: { value: InvoiceStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'PAID', label: 'Paid' },
  { value: 'LOCKED', label: 'Locked' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const LOCKED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'locked', label: 'Locked Only' },
  { value: 'unlocked', label: 'Unlocked Only' },
];

interface InvoiceFilterBarProps {
  onFiltersChange?: (filters: InvoiceFilters) => void;
}

export function InvoiceFilterBar({ onFiltersChange }: InvoiceFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSuperAdmin, isAdmin, scopedCustomerIds } = useAuth();

  const currentMonth = getCurrentMonth();

  const [from, setFrom] = useState(searchParams.get('from') || currentMonth);
  const [to, setTo] = useState(searchParams.get('to') || currentMonth);
  const [status, setStatus] = useState<InvoiceStatus | 'all'>(
    (searchParams.get('status') as InvoiceStatus) || 'all'
  );
  const [locked, setLocked] = useState<'all' | 'locked' | 'unlocked'>(
    (searchParams.get('locked') as 'all' | 'locked' | 'unlocked') || 'all'
  );
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') || 'all');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  // Check if user can select customers
  const canSelectCustomer = isSuperAdmin || isAdmin || scopedCustomerIds.length > 1;
  const isCustomerUser = scopedCustomerIds.length === 1 && !isSuperAdmin && !isAdmin;

  // Fetch customers for dropdown
  useEffect(() => {
    if (!canSelectCustomer) {
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

  // Generate month options (last 24 months)
  const monthOptions = getMonthRange('2024-01', currentMonth);

  // Update URL and notify parent
  const applyFilters = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status && status !== 'all') params.set('status', status);
    if (locked && locked !== 'all') params.set('locked', locked);
    if (customerId && customerId !== 'all') params.set('customerId', customerId);

    router.push(`/invoices?${params.toString()}`, { scroll: false });

    onFiltersChange?.({
      from,
      to,
      status: status === 'all' ? undefined : status,
      locked,
      customerId: customerId === 'all' ? undefined : customerId,
    });
  }, [from, to, status, locked, customerId, router, onFiltersChange]);

  useEffect(() => {
    applyFilters();
  }, [from, to, status, locked, customerId, applyFilters]);

  const handleReset = () => {
    setFrom(currentMonth);
    setTo(currentMonth);
    setStatus('all');
    setLocked('all');
    if (!isCustomerUser) setCustomerId('all');
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-4">
        {/* From Month */}
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select month" />
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
          <Label htmlFor="to">To</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select month" />
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

        {/* Status Filter */}
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus | 'all')}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Locked Filter */}
        <div className="space-y-1.5">
          <Label htmlFor="locked">Locked</Label>
          <Select value={locked} onValueChange={(v) => setLocked(v as 'all' | 'locked' | 'unlocked')}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {LOCKED_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Customer Filter (internal only) */}
        {canSelectCustomer && (
          <div className="space-y-1.5">
            <Label htmlFor="customerId">Customer</Label>
            <Select
              value={customerId}
              onValueChange={setCustomerId}
              disabled={isLoadingCustomers}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
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
          Reset
        </Button>
      </div>
    </Card>
  );
}
