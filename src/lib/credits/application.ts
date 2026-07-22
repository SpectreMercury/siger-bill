import { Prisma } from '@prisma/client';

export function calculateCreditApplicationAmount(
  creditRemaining: Prisma.Decimal,
  remainingInvoiceAmount: Prisma.Decimal,
  matchedPool: Prisma.Decimal | null
): Prisma.Decimal {
  const caps = [creditRemaining, remainingInvoiceAmount];
  if (matchedPool != null) caps.push(matchedPool);
  return caps.slice(1).reduce(
    (amount, cap) => Prisma.Decimal.min(amount, cap),
    caps[0]
  );
}
