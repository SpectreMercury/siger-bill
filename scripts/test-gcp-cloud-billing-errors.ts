import assert from 'node:assert/strict';
import { formatCloudBillingApiError } from '../src/lib/gcp/cloud-billing-errors';

const disabledPayload = `{
  "error": {
    "code": 403,
    "message": "Cloud Billing API has not been used in project 326807624205 before or it is disabled."
  }
}`;

const disabled = formatCloudBillingApiError(403, disabledPayload, 'project-260428-1');

assert.equal(disabled.code, 'CLOUD_BILLING_API_DISABLED');
assert.match(disabled.message, /Enable Cloud Billing API/);
assert.match(disabled.message, /project-260428-1/);
assert.match(disabled.message, /gcloud services enable cloudbilling.googleapis.com/);

const generic = formatCloudBillingApiError(403, '{"error":{"message":"Permission denied"}}');

assert.equal(generic.code, 'GCP_BILLING_API_ERROR');
assert.match(generic.message, /GCP Billing API returned 403/);

console.log('gcp cloud billing error formatting: ok');
