import assert from 'node:assert/strict';
import { createCreditSchema } from '../src/lib/utils/validation';

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

console.log('credit optional amount validation: ok');
