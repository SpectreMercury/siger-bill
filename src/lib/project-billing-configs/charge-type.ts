import { ProjectChargeType } from '@prisma/client';

export const PROJECT_CHARGE_TYPES = [
  ProjectChargeType.BILLABLE,
  ProjectChargeType.NON_BILLABLE,
  ProjectChargeType.CUD,
  ProjectChargeType.POC,
  ProjectChargeType.STARTUP,
] as const;

export function chargeTypeToBillable(chargeType: ProjectChargeType): boolean {
  return chargeType === ProjectChargeType.BILLABLE;
}
