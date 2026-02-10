'use client';

import { InvoiceStatus } from '@/lib/client/invoice-types';
import { getStatusInfo } from '@/lib/invoice-utils';

interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
  size?: 'sm' | 'md';
}

export function InvoiceStatusBadge({ status, size = 'md' }: InvoiceStatusBadgeProps) {
  const { label, color, bgColor } = getStatusInfo(status);

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center font-medium rounded-full ${sizeClasses} ${color} ${bgColor}`}>
      {label}
    </span>
  );
}

interface LockedBadgeProps {
  lockedAt: string | null;
  size?: 'sm' | 'md';
}

export function LockedBadge({ lockedAt, size = 'md' }: LockedBadgeProps) {
  if (!lockedAt) return null;

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1 font-medium rounded-full ${sizeClasses} text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30`}>
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
      </svg>
      Locked
    </span>
  );
}
