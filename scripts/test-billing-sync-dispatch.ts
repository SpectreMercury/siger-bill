import assert from 'node:assert/strict';
import {
  prepareBillingSyncDispatch,
  type BillingSyncDispatchJob,
  type BillingSyncDispatchLockedStore,
  type BillingSyncDispatchStore,
} from '../src/lib/billing/sync-dispatch';

type MemoryJob = BillingSyncDispatchJob & {
  billingMonth: string;
  connectionId: string | null;
  customerId: string | null;
};

function overlaps(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function createMemoryStore(seed: MemoryJob[] = []) {
  const jobs = [...seed];
  const audits: string[] = [];
  const lockTails = new Map<string, Promise<unknown>>();
  let nextId = 1;

  const lockedStore: BillingSyncDispatchLockedStore<MemoryJob> = {
    async findActive(input) {
      return jobs.find((job) =>
        job.billingMonth === input.billingMonth &&
        overlaps(job.scopeConnectionIds, input.scopeConnectionIds) &&
        (job.status === 'QUEUED' || job.status === 'RUNNING')
      ) ?? null;
    },
    async expireStaleRunning(job, staleBefore) {
      const current = jobs.find((candidate) => candidate.id === job.id);
      if (
        !current ||
        current.status !== 'RUNNING' ||
        current.updatedAt.getTime() > staleBefore.getTime()
      ) {
        return false;
      }
      current.status = 'FAILED';
      audits.push(current.id);
      return true;
    },
    async create(input) {
      const created: MemoryJob = {
        id: `new-${nextId++}`,
        status: 'QUEUED',
        createdBy: input.createdBy,
        updatedAt: input.now,
        billingMonth: input.billingMonth,
        connectionId: input.connectionId,
        customerId: input.customerId,
        scopeKey: input.scopeKey,
        scopeConnectionIds: input.scopeConnectionIds,
      };
      jobs.push(created);
      return created;
    },
  };

  const store: BillingSyncDispatchStore<MemoryJob> = {
    async withScopeLocks(scopeKeys, operation) {
      const sortedKeys = [...scopeKeys].sort();
      const previous = sortedKeys.map((key) => lockTails.get(key) ?? Promise.resolve());
      const current = Promise.all(previous).then(() => operation(lockedStore));
      for (const key of sortedKeys) {
        lockTails.set(key, current.catch(() => undefined));
      }
      return current;
    },
  };

  return { store, jobs, audits };
}

async function main() {
  const now = new Date('2026-07-20T08:00:00.000Z');
  const staleUpdatedAt = new Date('2026-07-18T02:40:13.743Z');
  const connectionA = '7ccf3cef-6451-42b9-835a-6394a3c73b8e';
  const connectionB = '8ddf3cef-6451-42b9-835a-6394a3c73b8e';
  const commonInput = {
    billingMonth: '2026-06',
    connectionId: connectionA,
    customerId: null,
    createdBy: 'admin-a',
    scopeKey: `connection:${connectionA}`,
    scopeConnectionIds: [connectionA],
    now,
    staleAfterMs: 10 * 60 * 1_000,
  };

  {
    const memory = createMemoryStore([{
      id: 'stale-own-job',
      status: 'RUNNING',
      createdBy: 'admin-a',
      updatedAt: staleUpdatedAt,
      billingMonth: '2026-06',
      connectionId: connectionA,
      customerId: null,
      scopeKey: `connection:${connectionA}`,
      scopeConnectionIds: [connectionA],
    }]);

    const result = await prepareBillingSyncDispatch(commonInput, memory.store);
    assert.equal(result.kind, 'created');
    assert.equal(memory.jobs.filter((job) => job.status === 'QUEUED').length, 1);
    assert.equal(memory.jobs.find((job) => job.id === 'stale-own-job')?.status, 'FAILED');
    assert.deepEqual(memory.audits, ['stale-own-job']);
  }

  {
    const memory = createMemoryStore([{
      id: 'other-users-stale-job',
      status: 'RUNNING',
      createdBy: 'admin-b',
      updatedAt: staleUpdatedAt,
      billingMonth: '2026-06',
      connectionId: null,
      customerId: 'customer-1',
      scopeKey: 'customer:customer-1',
      scopeConnectionIds: [connectionA],
    }]);

    const result = await prepareBillingSyncDispatch({
      ...commonInput,
      connectionId: null,
      customerId: 'customer-1',
      createdBy: 'finance-a',
      scopeKey: 'customer:customer-1',
    }, memory.store);

    assert.equal(result.kind, 'created');
    assert.equal(memory.jobs[0].status, 'FAILED');
    assert.deepEqual(memory.audits, ['other-users-stale-job']);
  }

  {
    const memory = createMemoryStore();
    const [first, second] = await Promise.all([
      prepareBillingSyncDispatch(commonInput, memory.store),
      prepareBillingSyncDispatch(commonInput, memory.store),
    ]);

    assert.equal(memory.jobs.length, 1, 'concurrent dispatches must create only one job');
    assert.deepEqual([first.kind, second.kind].sort(), ['created', 'existing']);
  }

  {
    const memory = createMemoryStore();
    const [first, second] = await Promise.all([
      prepareBillingSyncDispatch({
        ...commonInput,
        connectionId: null,
        createdBy: 'finance-a',
        scopeKey: 'creator:finance-a',
        scopeConnectionIds: [connectionA],
      }, memory.store),
      prepareBillingSyncDispatch({
        ...commonInput,
        connectionId: null,
        createdBy: 'finance-b',
        scopeKey: 'creator:finance-b',
        scopeConnectionIds: [connectionB],
      }, memory.store),
    ]);

    assert.deepEqual([first.kind, second.kind], ['created', 'created']);
    assert.equal(memory.jobs.length, 2, 'disjoint effective connection scopes may run independently');
  }

  {
    const memory = createMemoryStore([{
      id: 'restricted-users-job',
      status: 'RUNNING',
      createdBy: 'finance-a',
      updatedAt: now,
      billingMonth: '2026-06',
      connectionId: null,
      customerId: null,
      scopeKey: 'creator:finance-a',
      scopeConnectionIds: [connectionB],
    }]);

    const result = await prepareBillingSyncDispatch({
      ...commonInput,
      connectionId: null,
      scopeKey: 'global',
      scopeConnectionIds: [connectionA, connectionB],
    }, memory.store);

    assert.equal(result.kind, 'conflict');
    assert.equal(memory.jobs.length, 1, 'a wider overlapping scope must wait for the active job');
  }

  {
    const memory = createMemoryStore([{
      id: 'global-job',
      status: 'RUNNING',
      createdBy: 'admin-a',
      updatedAt: now,
      billingMonth: '2026-06',
      connectionId: null,
      customerId: null,
      scopeKey: 'global',
      scopeConnectionIds: [connectionA, connectionB],
    }]);

    const result = await prepareBillingSyncDispatch(commonInput, memory.store);
    assert.equal(result.kind, 'existing');
    assert.equal(result.job.id, 'global-job', 'a wider active job covers a targeted request');
  }

  {
    const memory = createMemoryStore([{
      id: 'stale-global-job',
      status: 'RUNNING',
      createdBy: 'admin-a',
      updatedAt: staleUpdatedAt,
      billingMonth: '2026-06',
      connectionId: null,
      customerId: null,
      scopeKey: 'global',
      scopeConnectionIds: [connectionA, connectionB],
    }]);

    const result = await prepareBillingSyncDispatch(commonInput, memory.store);
    assert.equal(result.kind, 'conflict');
    assert.equal(memory.jobs[0].status, 'RUNNING', 'narrow scope must not expire a broader job');
    assert.deepEqual(memory.audits, []);
  }

  console.log('billing sync dispatch behavior tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
