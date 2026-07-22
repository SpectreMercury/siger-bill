import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calculateCreditApplicationAmount } from '../src/lib/credits/application';

const d = (value: string) => new Prisma.Decimal(value);

assert.equal(
  calculateCreditApplicationAmount(d('50'), d('80'), null).toString(),
  '50',
  'the amount must use the current locked credit balance'
);
assert.equal(
  calculateCreditApplicationAmount(d('100'), d('80'), d('30')).toString(),
  '30',
  'the matched pool must cap usage'
);
assert.equal(
  calculateCreditApplicationAmount(d('100'), d('80'), null).toString(),
  '80',
  'the invoice balance must cap usage'
);

console.log('credit application tests passed');
