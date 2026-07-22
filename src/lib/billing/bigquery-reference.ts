const BIGQUERY_PATH_PART = /^[A-Za-z0-9_*$-]+$/;

export function isValidBigQueryPathPart(value: string): boolean {
  return value.length > 0 && BIGQUERY_PATH_PART.test(value);
}

export function assertValidBigQueryPathPart(
  value: string,
  kind: 'dataset' | 'table'
): void {
  if (isValidBigQueryPathPart(value)) return;

  const label = kind === 'dataset' ? 'Dataset name' : 'Table name';
  const example = kind === 'dataset' ? 'sieger_billing_share' : 'test_billing_2';
  throw new Error(
    `${label} must not include project or dataset prefixes; enter only "${example}".`
  );
}
