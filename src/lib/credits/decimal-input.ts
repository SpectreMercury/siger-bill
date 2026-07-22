const CREDIT_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.(\d{1,4}))?$/;

/** Normalize DECIMAL(18,4) input to a fixed-width string for exact comparison. */
export function normalizeCreditAmount(value: string): string | null {
  const trimmed = value.trim();
  const match = CREDIT_AMOUNT_PATTERN.exec(trimmed);
  if (!match) return null;

  const [integerPart] = trimmed.split('.');
  const fractionPart = match[1] ?? '';
  return `${integerPart.padStart(14, '0')}${fractionPart.padEnd(4, '0')}`;
}

export function compareCreditAmounts(left: string, right: string): -1 | 0 | 1 | null {
  const normalizedLeft = normalizeCreditAmount(left);
  const normalizedRight = normalizeCreditAmount(right);
  if (normalizedLeft == null || normalizedRight == null) return null;
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

export function creditAmountChanged(left: string, right: string): boolean {
  return compareCreditAmounts(left, right) !== 0;
}
