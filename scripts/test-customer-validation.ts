import assert from 'node:assert/strict';
import { createCustomerSchema, updateCustomerSchema } from '../src/lib/utils/validation';

const createResult = createCustomerSchema.safeParse({
  name: 'Blank Optional Fields LLC',
  externalId: '',
  billingAccountId: '',
  domain: '',
  currency: 'USD',
  paymentTermsDays: 30,
  primaryContactName: '',
  primaryContactEmail: '',
  gcpConnectionId: null,
});

if (!createResult.success) {
  throw new Error(`createCustomerSchema rejected blank optional fields: ${JSON.stringify(createResult.error.flatten())}`);
}

assert.equal(createResult.data.externalId, undefined);
assert.equal(createResult.data.billingAccountId, undefined);
assert.equal(createResult.data.domain, undefined);
assert.equal(createResult.data.primaryContactName, undefined);
assert.equal(createResult.data.primaryContactEmail, undefined);

const updateResult = updateCustomerSchema.safeParse({
  externalId: '',
  billingAccountId: '',
  domain: '',
  primaryContactName: '',
  primaryContactEmail: '',
});

if (!updateResult.success) {
  throw new Error(`updateCustomerSchema rejected blank optional fields: ${JSON.stringify(updateResult.error.flatten())}`);
}

assert.equal(updateResult.data.externalId, null);
assert.equal(updateResult.data.billingAccountId, null);
assert.equal(updateResult.data.domain, null);
assert.equal(updateResult.data.primaryContactName, null);
assert.equal(updateResult.data.primaryContactEmail, null);

console.log('customer validation blank optional fields: ok');
