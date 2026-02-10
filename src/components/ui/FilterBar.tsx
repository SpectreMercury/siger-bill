'use client';

import { ReactNode } from 'react';
import { Button } from './Button';

interface FilterBarProps {
  children: ReactNode;
  onReset?: () => void;
  className?: string;
}

export function FilterBar({ children, onReset, className = '' }: FilterBarProps) {
  return (
    <div
      className={`
        flex flex-wrap items-end gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200
        ${className}
      `}
    >
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  );
}

interface FilterFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function FilterField({ label, children, className = '' }: FilterFieldProps) {
  return (
    <div className={`flex-1 min-w-[150px] max-w-[250px] ${className}`}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

interface MonthFilterProps {
  value: string;
  onChange: (value: string) => void;
  availableMonths?: string[];
}

export function MonthFilter({ value, onChange, availableMonths }: MonthFilterProps) {
  // Generate last 12 months if not provided
  const months = availableMonths || generateLast12Months();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
    >
      <option value="">All Months</option>
      {months.map((month) => (
        <option key={month} value={month}>
          {formatMonth(month)}
        </option>
      ))}
    </select>
  );
}

function generateLast12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function formatMonth(month: string): string {
  const [year, monthNum] = month.split('-');
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}
