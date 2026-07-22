export type BillingSyncDispatchStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type BillingSyncDispatchJob = {
  id: string;
  status: BillingSyncDispatchStatus;
  createdBy: string;
  updatedAt: Date;
  scopeKey: string;
  scopeConnectionIds: string[];
};

export type BillingSyncDispatchInput = {
  billingMonth: string;
  connectionId: string | null;
  customerId: string | null;
  createdBy: string;
  scopeKey: string;
  scopeConnectionIds: string[];
  now: Date;
  staleAfterMs: number;
};

export type BillingSyncDispatchLockedStore<TJob extends BillingSyncDispatchJob> = {
  findActive(input: BillingSyncDispatchInput): Promise<TJob | null>;
  expireStaleRunning(job: TJob, staleBefore: Date): Promise<boolean>;
  create(input: BillingSyncDispatchInput): Promise<TJob>;
};

export type BillingSyncDispatchStore<TJob extends BillingSyncDispatchJob> = {
  withScopeLocks<TResult>(
    scopeKeys: string[],
    operation: (store: BillingSyncDispatchLockedStore<TJob>) => Promise<TResult>
  ): Promise<TResult>;
};

export type BillingSyncDispatchResult<TJob extends BillingSyncDispatchJob> =
  | { kind: 'created' | 'existing'; job: TJob; shouldRun: boolean }
  | { kind: 'conflict'; job: TJob; shouldRun: false };

function buildScopeLockKeys(input: BillingSyncDispatchInput): string[] {
  const connectionIds = Array.from(new Set(input.scopeConnectionIds)).sort();
  if (connectionIds.length === 0) {
    throw new Error('Billing sync dispatch requires at least one resolved connection');
  }
  return connectionIds.map((connectionId) => [
    'billing-sync',
    input.billingMonth,
    connectionId,
  ].join('|'));
}

function coversScope(existingConnectionIds: string[], requestedConnectionIds: string[]): boolean {
  const existing = new Set(existingConnectionIds);
  return requestedConnectionIds.every((connectionId) => existing.has(connectionId));
}

export async function prepareBillingSyncDispatch<TJob extends BillingSyncDispatchJob>(
  input: BillingSyncDispatchInput,
  store: BillingSyncDispatchStore<TJob>
): Promise<BillingSyncDispatchResult<TJob>> {
  const staleBefore = new Date(input.now.getTime() - input.staleAfterMs);

  return store.withScopeLocks(buildScopeLockKeys(input), async (lockedStore) => {
    let existingJob = await lockedStore.findActive(input);

    if (
      existingJob?.status === 'RUNNING' &&
      existingJob.updatedAt.getTime() <= staleBefore.getTime()
    ) {
      if (!coversScope(input.scopeConnectionIds, existingJob.scopeConnectionIds)) {
        return { kind: 'conflict', job: existingJob, shouldRun: false };
      }
      const expired = await lockedStore.expireStaleRunning(existingJob, staleBefore);
      existingJob = expired ? null : await lockedStore.findActive(input);
    }

    if (existingJob) {
      if (!coversScope(existingJob.scopeConnectionIds, input.scopeConnectionIds)) {
        return { kind: 'conflict', job: existingJob, shouldRun: false };
      }
      return {
        kind: 'existing',
        job: existingJob,
        shouldRun: existingJob.status === 'QUEUED',
      };
    }

    const job = await lockedStore.create(input);
    return { kind: 'created', job, shouldRun: true };
  });
}
