import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'src/app/api/invoice-runs/[id]/route.ts'),
  'utf8'
);

assert(
  !source.includes('routeContext'),
  'invoice run detail route must not read a third routeContext argument'
);

assert(
  source.includes('context.params.id'),
  'invoice run detail route must read dynamic id from withPermission context.params'
);

console.log('invoice run detail route params verified.');
