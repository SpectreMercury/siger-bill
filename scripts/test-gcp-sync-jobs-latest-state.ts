import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageSource = readFileSync(
  join(process.cwd(), 'src/app/(console)/admin/gcp-connections/page.tsx'),
  'utf8'
);

const fetchStart = pageSource.indexOf('const fetchRecentSyncJobs = useCallback(async () => {');
assert.notEqual(fetchStart, -1, 'GCP connections page must load recent billing sync jobs');

const fetchEnd = pageSource.indexOf('\n  }, [applySyncJobState, pollSyncJob]);', fetchStart);
assert.notEqual(fetchEnd, -1, 'fetchRecentSyncJobs dependency block must remain recognizable');

const fetchBlock = pageSource.slice(fetchStart, fetchEnd);

assert(
  fetchBlock.includes('const appliedSyncConnectionIds = new Set<string>();'),
  'fetchRecentSyncJobs must track which connection IDs already received their latest sync state'
);

assert(
  fetchBlock.includes('const key = syncKey(job.connectionId);'),
  'fetchRecentSyncJobs must use the same sync state key as the rest of the page'
);

assert(
  fetchBlock.includes('if (appliedSyncConnectionIds.has(key)) continue;'),
  'fetchRecentSyncJobs must skip older jobs for a connection after the latest job is applied'
);

assert(
  fetchBlock.includes('appliedSyncConnectionIds.add(key);'),
  'fetchRecentSyncJobs must mark a connection as applied before processing older jobs'
);

assert(
  fetchBlock.indexOf('appliedSyncConnectionIds.add(key);') < fetchBlock.indexOf('applySyncJobState(job);'),
  'fetchRecentSyncJobs must mark a connection before applying state so later jobs cannot overwrite it'
);

console.log('GCP sync job latest-state safeguard verified.');
