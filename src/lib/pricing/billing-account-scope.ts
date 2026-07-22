export function normalizePricingBillingAccountIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const billingAccountId = value.trim();
    if (!billingAccountId || seen.has(billingAccountId)) continue;
    seen.add(billingAccountId);
    normalized.push(billingAccountId);
  }
  return normalized;
}

export function matchesPricingBillingAccount(
  configuredBillingAccountIds: readonly string[],
  billingAccountId: string | null | undefined
): boolean {
  const configured = normalizePricingBillingAccountIds(configuredBillingAccountIds);
  if (configured.length === 0) return true;
  return billingAccountId != null && configured.includes(billingAccountId.trim());
}
