import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/billing/unified-engine.ts'), 'utf8');
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
const ingestStart = source.indexOf('export async function ingestFromAdapter');
assert.notEqual(ingestStart, -1, 'unified engine must expose ingestFromAdapter');

const nextSection = source.indexOf('/**\n * Execute a unified invoice run', ingestStart);
assert.notEqual(nextSection, -1, 'ingestFromAdapter block must remain recognizable');

const ingestBlock = source.slice(ingestStart, nextSection);

assert(
  ingestBlock.includes('isActive: false'),
  'New ingestion batches must be created inactive while line items are still loading'
);

assert(
  ingestBlock.includes('bulkInsertLineItemChunk'),
  'Line item chunks must use the bulk SQL insert helper'
);

assert(
  ingestBlock.includes('jsonb_to_recordset'),
  'Line item chunks must use jsonb_to_recordset bulk SQL to avoid slow Prisma createMany loops'
);

assert(
  ingestBlock.includes('gen_random_uuid()'),
  'Raw SQL inserts must generate BillingLineItem.id because the database column has no default'
);

assert(
  ingestBlock.includes('statement_timeout'),
  'Each bulk insert must set a statement timeout so a large chunk cannot hang indefinitely'
);

assert(
  ingestBlock.includes('idle_in_transaction_session_timeout'),
  'Each bulk insert must set an idle transaction timeout for abandoned serverless connections'
);

assert(
  !ingestBlock.includes('await tx.billingLineItem.createMany'),
  'Line item chunks must not be inserted inside one long interactive transaction'
);

assert(
  !ingestBlock.includes('await prisma.billingLineItem.createMany'),
  'Line item chunks must not use Prisma createMany for large BigQuery imports'
);

assert(
  ingestBlock.includes('activateLoadedBatch'),
  'Ingest must use a short final transaction to activate the fully loaded batch'
);

assert(
  ingestBlock.includes('cleanupIncompleteBatch'),
  'Ingest must clean up an inactive batch if chunk loading fails'
);

assert(
  source.includes('BILLING_INCOMPLETE_BATCH_STALE_AFTER_MS') &&
    ingestBlock.includes('existingBatch.updatedAt <= incompleteBatchStaleBefore'),
  'Ingest must only clean an incomplete batch after its loading lease has expired'
);

assert(
  ingestBlock.includes('isCompleteBatch(incompleteBatchAfterCleanup)') &&
    ingestBlock.includes('is already loading'),
  'Ingest must never activate or reuse another sync worker\'s incomplete batch'
);

assert(
  !ingestBlock.includes('prisma.billingLineItem.deleteMany') &&
    ingestBlock.includes('updatedAt: { lte: staleBefore }') &&
    ingestBlock.includes('cleanupResult.count !== 1'),
  'Stale cleanup must atomically recheck inactive state and lease cutoff before cascading'
);

assert(
  schema.includes('updatedAt') && ingestBlock.includes('updatedAt: new Date()'),
  'Chunked ingestion must renew the incomplete batch lease after each inserted chunk'
);

console.log('billing ingest short transaction safeguard verified.');
