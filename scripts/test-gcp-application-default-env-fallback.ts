import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/gcp/auth.ts'), 'utf8');
const start = source.indexOf('export async function gcpFetchHeaders');
const end = source.indexOf('\nexport function withApiKey', start);
assert(start !== -1 && end !== -1, 'gcpFetchHeaders block must be present');

const block = source.slice(start, end);
const applicationDefaultBranch = block.indexOf("conn.authType === 'APPLICATION_DEFAULT'");
const envFallback = block.indexOf('getEnvServiceAccountHeaders()', applicationDefaultBranch);
const adcExchange = block.indexOf('exchangeApplicationDefaultToken(conn.id)', applicationDefaultBranch);

assert(
  applicationDefaultBranch !== -1 &&
    envFallback !== -1 &&
    adcExchange !== -1 &&
    envFallback < adcExchange,
  'APPLICATION_DEFAULT must use configured environment service-account credentials before ADC'
);

console.log('GCP application-default environment fallback verified.');
