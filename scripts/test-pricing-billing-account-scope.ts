import assert from 'node:assert/strict';
import {
  matchesPricingBillingAccount,
  normalizePricingBillingAccountIds,
} from '../src/lib/pricing/billing-account-scope';

assert.equal(matchesPricingBillingAccount([], 'BILL-1'), true);
assert.equal(matchesPricingBillingAccount(['BILL-1', 'BILL-2'], 'BILL-2'), true);
assert.equal(matchesPricingBillingAccount(['BILL-1'], 'BILL-3'), false);
assert.equal(matchesPricingBillingAccount(['BILL-1'], null), false);
assert.deepEqual(
  normalizePricingBillingAccountIds([' BILL-2 ', 'BILL-1', 'BILL-2', '']),
  ['BILL-2', 'BILL-1']
);

console.log('pricing billing account scope tests passed');
