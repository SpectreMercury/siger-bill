import { Prisma } from '@prisma/client';

type BindingClient = Pick<Prisma.TransactionClient, 'customerProject'>;

export type CustomerProjectBindingActivation = 'KEEP' | 'REACTIVATE' | 'CREATE';

export function chooseCustomerProjectBindingActivation(
  activeBindingId: string | null,
  sameDayInactiveBindingId: string | null
): CustomerProjectBindingActivation {
  if (activeBindingId) return 'KEEP';
  return sameDayInactiveBindingId ? 'REACTIVATE' : 'CREATE';
}

/**
 * Activate a customer/project binding without violating the date-granularity
 * unique key when the same relationship is cleared and restored on one day.
 */
export async function ensureActiveCustomerProjectBinding(
  db: BindingClient,
  customerId: string,
  projectId: string,
  at = new Date()
): Promise<void> {
  const active = await db.customerProject.findFirst({
    where: { customerId, projectId, isActive: true },
    select: { id: true },
  });

  const dayStart = new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const nextDay = new Date(dayStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const sameDayInactive = active
    ? null
    : await db.customerProject.findFirst({
        where: {
          customerId,
          projectId,
          isActive: false,
          startDate: { gte: dayStart, lt: nextDay },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });

  const action = chooseCustomerProjectBindingActivation(
    active?.id ?? null,
    sameDayInactive?.id ?? null
  );
  if (action === 'KEEP') return;
  if (action === 'REACTIVATE') {
    await db.customerProject.update({
      where: { id: sameDayInactive!.id },
      data: { isActive: true, endDate: null },
    });
    return;
  }

  await db.customerProject.create({
    data: {
      customerId,
      projectId,
      isActive: true,
      startDate: dayStart,
    },
  });
}
