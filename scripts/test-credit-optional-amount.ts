import assert from 'node:assert/strict';
import { createCreditSchema, updateCreditSchema } from '../src/lib/utils/validation';

const baseCredit = {
  types: ['DISCOUNT'],
  currency: 'USD',
  validFrom: '2026-06-01',
  validTo: '2026-06-30',
};

for (const [label, totalAmount] of [
  ['omitted', undefined],
  ['blank string', ''],
  ['null', null],
] as const) {
  const input = totalAmount === undefined ? baseCredit : { ...baseCredit, totalAmount };
  const result = createCreditSchema.safeParse(input);

  if (!result.success) {
    throw new Error(`createCreditSchema rejected ${label} totalAmount: ${JSON.stringify(result.error.flatten())}`);
  }

  assert.equal(result.data.totalAmount, 0);
}

const negativeResult = createCreditSchema.safeParse({
  ...baseCredit,
  totalAmount: -1,
});

assert.equal(negativeResult.success, false);

const editableCredit = updateCreditSchema.safeParse({
  expectedUpdatedAt: '2026-07-15T08:00:00.000Z',
  types: ['DISCOUNT', 'PROMOTION'],
  totalAmount: '900000.0000',
  remainingAmount: '850000.0000',
  validFrom: '2026-06-01',
  validTo: '2027-06-30',
  status: 'ACTIVE',
  allowCarryOver: true,
  adjustmentReason: 'Approved contract correction',
});

assert.equal(editableCredit.success, true, 'credit amounts and start date should be editable');
if (editableCredit.success) {
  assert.deepEqual(editableCredit.data.types, ['DISCOUNT', 'PROMOTION']);
  assert.equal(editableCredit.data.totalAmount, '900000.0000');
  assert.equal(editableCredit.data.remainingAmount, '850000.0000');
  assert.equal(editableCredit.data.validFrom, '2026-06-01');
}

assert.equal(updateCreditSchema.safeParse({
  expectedUpdatedAt: '2026-07-15T08:00:00.000Z',
  totalAmount: '-1',
}).success, false);
assert.equal(updateCreditSchema.safeParse({
  expectedUpdatedAt: '2026-07-15T08:00:00.000Z',
  remainingAmount: '-1',
}).success, false);
assert.equal(updateCreditSchema.safeParse({ totalAmount: 1 }).success, false);
assert.equal(updateCreditSchema.safeParse({
  expectedUpdatedAt: '2026-07-15T08:00:00.000Z',
  remainingAmount: '0.99995',
}).success, false, 'remaining amount must have at most 4 decimal places');
assert.equal(updateCreditSchema.safeParse({
  expectedUpdatedAt: '2026-07-15T08:00:00.000Z',
  totalAmount: '100000000000000.0000',
}).success, false, 'DECIMAL(18,4) allows at most 14 integer digits');

console.log('credit optional amount validation: ok');
