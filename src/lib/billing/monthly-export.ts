const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(INVALID_FILENAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ');
}

export function buildMonthlyBillingExportFilename(
  billingMonth: string,
  customerName?: string | null
): string {
  const compactMonth = billingMonth.replace(/-/g, '');
  const safeCustomerName = sanitizeFilenamePart(customerName || 'all') || 'all';
  return `billing-${compactMonth}-${safeCustomerName}.xlsx`;
}

export function buildMonthlyBillingExportContentDisposition(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7e]+/g, 'customer')
    .replace(/["\\]/g, '-');
  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

export function filenameFromContentDisposition(disposition: string | null): string | null {
  if (!disposition) return null;

  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      // Fall through to the ASCII filename when the encoded value is malformed.
    }
  }

  return disposition.match(/filename="([^"]+)"/i)?.[1]
    ?? disposition.match(/filename=([^;]+)/i)?.[1]?.trim()
    ?? null;
}
