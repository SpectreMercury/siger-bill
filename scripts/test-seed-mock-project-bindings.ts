import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const seedMock = readFileSync(join(process.cwd(), 'prisma/seed-mock-data.ts'), 'utf8');

assert(
  seedMock.includes('projectBillingConfig.upsert'),
  'mock seed must create ProjectBillingConfig rows before CustomerProject bindings'
);

assert(
  seedMock.includes('projectIds.push(created.projectId)'),
  'mock seed must bind CustomerProject.projectId using the GCP project_id string, not Project.id UUID'
);

assert(
  !seedMock.includes('projectIds.push(created.id)'),
  'mock seed must not store Project.id UUIDs as customer project IDs'
);

console.log('mock seed project binding safeguards verified.');
