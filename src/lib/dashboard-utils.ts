/**
 * Dashboard utility functions
 */

/**
 * Format currency value
 */
export function formatCurrency(value: string | number, currency = 'USD'): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

/**
 * Format currency with decimals
 */
export function formatCurrencyPrecise(value: string | number, currency = 'USD'): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format percentage
 */
export function formatPercent(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`;
}

/**
 * Format month string (YYYY-MM) to display format
 */
export function formatMonth(month: string): string {
  if (!month) return '-';
  const [year, monthNum] = month.split('-');
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

/**
 * Format month string to long format
 */
export function formatMonthLong(month: string): string {
  if (!month) return '-';
  const [year, monthNum] = month.split('-');
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

/**
 * Get current month in YYYY-MM format
 */
export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get month N months ago in YYYY-MM format
 */
export function getMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Generate array of months between from and to (inclusive)
 */
export function getMonthRange(from: string, to: string): string[] {
  const months: string[] = [];
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);

  let currentYear = fromYear;
  let currentMonth = fromMonth;

  while (currentYear < toYear || (currentYear === toYear && currentMonth <= toMonth)) {
    months.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }

  return months;
}

/**
 * Default filter range (last 6 months)
 */
export function getDefaultDateRange(): { from: string; to: string } {
  return {
    from: getMonthsAgo(5),
    to: getCurrentMonth(),
  };
}
