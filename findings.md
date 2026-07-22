# Findings & Decisions

## 2026-07-13 Production Regression QA
- Previous QA and deployment evidence is useful as a baseline only; current production, database, and deployment state must be freshly verified.
- The working tree contains the prior billing resilience fixes plus unrelated/user work, so this pass must preserve all existing changes and avoid destructive cleanup.
- High-risk regression targets are monthly billing customer filters, empty/non-JSON API responses, Cloud SQL transient failures, GCP connection tests, sync job ordering, and duplicate billing ingestion.
- `cleanupIncompleteBatch` deletes only the specified inactive partial batch and its partial lines. The previous regression test incorrectly treated this as deletion of old ingestion history; active and superseded historical batches remain preserved.
- Production login completed successfully and redirected to `/dashboard?from=2026-02&to=2026-07`; the initial browser wait failed only because it expected the exact bare `/dashboard` URL.
- Chrome logs include MetaMask/other wallet extension injection errors. A generic storage-access error was also logged without an application stack, while JWT storage and authenticated navigation continued to work; it remains under observation during the clean page sweep.
- The production page sweep reproduced an actual `/api/me` 500. Vercel expanded logs identify Prisma `P2037 TooManyConnections`; after that response, `AuthContext.refreshUser` unconditionally cleared the token and redirected every subsequent page to login.
- A direct `psql` diagnostic was also rejected because only reserved connection slots remained. The connection exhaustion is active at the database, not only a stale Vercel log.
- Independent review correctly identified that Prisma `$allOperations` retry can duplicate non-idempotent writes, same-month active-batch reuse can hide delayed BigQuery updates, inactive batches need a loading lease for concurrency, and non-401 `/me` failures need an explicit recoverable UI state.
- A second review found that deleting child rows before conditionally deleting an inactive parent can empty a batch that concurrently became active. Cleanup must delete the inactive parent atomically and rely on its cascade; the lease also needs a renewable timestamp rather than immutable `createdAt`.
- Final review identified a remaining check/delete race: `updatedAt <= cutoff` must be part of the same `deleteMany` predicate, otherwise a worker that just renewed its heartbeat could still be deleted.
- Production GCP connection tests returned 200 but emitted ADC credential errors. The configured connection is `APPLICATION_DEFAULT`; `gcpFetchHeaders` tried ADC before the valid `GCP_SERVICE_ACCOUNT_JSON` fallback.

## Requirements
- Migrate the currently used database from Neon to GCP.
- Update the app so Neon is no longer the active production database.
- Operate directly in the repo and deployment environment.

## Research Findings
- Current local database env points to Neon hosts in `ap-southeast-1.aws.neon.tech`, with both pooled and unpooled URLs.
- Prisma runtime is currently hard-wired to `@prisma/adapter-neon` in `src/lib/db/prisma.ts`; seed scripts also instantiate `PrismaNeon`.
- `package.json` includes `@neondatabase/serverless` and `@prisma/adapter-neon`; no generic PostgreSQL Prisma adapter is installed yet.
- `prisma/schema.prisma` uses PostgreSQL provider without a datasource URL in schema, consistent with Prisma 7 adapter-based runtime.
- Local tools available: `gcloud`, `psql`, `pg_dump`, `pg_restore`, and `vercel`.
- Active GCP account/project: `j.lee17th@gmail.com` on `project-260428-1`.
- Cloud SQL Admin API is not enabled yet on `project-260428-1`.
- Cloud SQL Admin API is now enabled.
- Created Cloud SQL instance `sieger-billing-pg` in `asia-southeast1-c`, PostgreSQL 17, tier `db-f1-micro`, public IP `34.87.157.137`, state `RUNNABLE`.
- Created database `sieger_billing` and app user `sieger_app`.
- Verified `sieger_app` can connect to Cloud SQL with SSL and create/drop tables.
- Installed `postgresql@17` locally so `pg_dump`/`pg_restore` match the Postgres 17 source/target versions.
- Neon final dump stored at `/private/tmp/sieger-db-migration-2026-06-07T17-11-06-052Z/neon-final.dump`.
- Restored the dump into Cloud SQL `sieger_billing`.
- Exact row count comparison across 37 public tables found 0 mismatches.
- Switched Prisma runtime and seed scripts from `@prisma/adapter-neon` to `@prisma/adapter-pg`.
- Removed Neon packages and added `@prisma/adapter-pg`/`pg`.
- Updated local `.env` database variables to Cloud SQL after backing up the old `.env` at `/private/tmp/sieger-env-before-cloudsql-2026-06-07T17-17-17-559Z.env`.
- Updated Vercel database-related environment variables to Cloud SQL for all existing environments.
- Patched Cloud SQL instance SSL mode to `ENCRYPTED_ONLY`.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Use Cloud SQL PostgreSQL as the default GCP target | It preserves the current PostgreSQL/Prisma data model with the least application change. |
| Replace Neon-specific Prisma adapter usage | Cloud SQL cannot use the Neon serverless adapter; runtime and seed scripts need a normal PostgreSQL-compatible adapter/client. |
| Use Cloud SQL public IP during Vercel cutover | Vercel's current deployment does not provide a known stable egress IP, so Cloud SQL authorized networks must be broad unless the app uses a connector or static egress later. |
| Use `sslmode=no-verify` for the current Cloud SQL URL | It enables TLS with Cloud SQL public IP while avoiding hostname/CA validation failure in `pg`; Cloud SQL itself now rejects unencrypted connections. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Cloud SQL `POSTGRES_17` first create attempt rejected `db-f1-micro` under Enterprise Plus | Re-ran create with `--edition=enterprise`. |
| `ALTER DATABASE ... OWNER TO sieger_app` failed under Cloud SQL's restricted `postgres` role | Used grants instead and verified application user DDL permissions. |
| PrismaPg with `sslmode=require` failed with `unable to verify the first certificate` | Switched URL to `sslmode=no-verify` and patched Cloud SQL to encrypted-only. |

## Resources
- Repo: `/Users/error404/Documents/Sieger/bill-system`
- Expected GCP project from prior work: `project-260428-1`

## 2026-07-09 QA Findings
- The reported `Unexpected end of JSON input` class was fixed by making the client response parser tolerate empty/non-JSON responses and by ensuring middleware returns JSON on auth/context failures.
- Monthly billing needed safer DB access under Cloud SQL: active-source and monthly-override reads were made sequential, monthly export prefilters active ingestion batches, and the template lookup gained a supporting index.
- User list used `t('roles')` while `users.roles` is a nested translation object, causing `next-intl` `INSUFFICIENT_PATH`. The page now uses `users.roleLabel`.
- Login/auth refresh was logging expected `/me` 401 states. `AuthContext` now suppresses expected auth failures while preserving logging for real failures.
- Cloud SQL public-IP connections can transiently fail with TLS reset/connection timeout errors. Prisma client operations, auth context loads, and seed writes now use bounded transient retry and the pg pool has keepalive plus longer connection/idle timeouts.
- `prisma/seed-mock-data.ts` was stale after the project-binding refactor: it was binding `CustomerProject.projectId` to `Project.id` UUIDs. It now creates `ProjectBillingConfig` records and binds to the GCP `project_id` string.
- `/api/invoice-runs/[id]` incorrectly read a third `routeContext` argument under `withPermission`; production route handlers receive dynamic params via `context.params`.
