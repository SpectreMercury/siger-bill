import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const file of ['prisma/seed.ts', 'prisma/seed-mock-data.ts']) {
  const source = readFileSync(join(process.cwd(), file), 'utf8');

  assert(
    source.includes('withTransientSeedRetry'),
    `${file} must retry transient Cloud SQL write failures during seed`
  );

  assert(
    source.includes('Client has encountered a connection error and is not queryable') &&
      source.includes('Connection terminated due to connection timeout') &&
      source.includes('secure TLS connection was established') &&
      source.includes('ECONNRESET'),
    `${file} retry classifier must cover observed Cloud SQL connection reset errors`
  );
}

console.log('seed transient retry safeguards verified.');
