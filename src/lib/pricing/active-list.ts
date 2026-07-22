import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * A customer may temporarily have more than one ACTIVE list while an admin is
 * preparing a replacement. Billing must still resolve that state consistently.
 */
export const ACTIVE_PRICING_LIST_ORDER: Prisma.PricingListOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { id: 'desc' },
];

export async function loadActivePricingBillingAccountIds(customerId: string): Promise<string[]> {
  const pricingList = await prisma.pricingList.findFirst({
    where: { customerId, status: 'ACTIVE' },
    orderBy: ACTIVE_PRICING_LIST_ORDER,
    select: { billingAccountIds: true },
  });
  return pricingList?.billingAccountIds ?? [];
}
