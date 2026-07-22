# Progress Log

## Session: 2026-07-13

### Production Regression QA And Redeploy
- **Status:** in progress
- Recovered the previous QA/deployment context and inspected the current dirty worktree.
- Loaded systematic debugging, test-driven development, file-based planning, and completion-verification procedures.
- Started a fresh production-focused verification pass with rollback requirements for all test data.
- Baseline regression scripts: 16 passed and `test-billing-active-source` failed due to a stale over-broad assertion; root cause confirmed before changing the test.
- Corrected the active-source regression contract and confirmed it passes.
- `npm run lint` exposed missing/non-interactive ESLint configuration; added an ESLint 9 flat config and updated the script.
- The first real lint pass found 6 errors. Applied scoped fixes for CommonJS config files, checksum crypto import, empty prop types, and dashboard helper declaration order.
- `npm run lint` now exits 0 with 0 errors (38 existing warnings remain).
- Production login succeeded as `admin@sieger.com`; Dashboard loaded with authenticated navigation and data widgets.
- Production stress navigation reproduced `/api/me` 500 followed by logout. Vercel logs proved `P2037 TooManyConnections`.
- Added and observed failing regression tests for `P2037` retry, Vercel pool size, and preserving auth on non-401 refresh failures.
- Implemented the minimal root fix: one connection per Vercel function by default, retry `P2037`, and clear auth only for expected 401 failures.
- Independent review found unsafe global retries plus billing/auth concurrency gaps; deployment was stopped before publish.
- Added and observed failing tests for explicit-only Prisma retries, time-bounded batch reuse, incomplete-batch leases, and recoverable auth failures.
- Implemented the review fixes: removed global `$allOperations` retry, added 5-minute active-batch freshness, protected 30-minute in-progress batches, and added auth retry UI state.
- Second review identified an activation/cleanup race and non-renewing lease; observed the new regression test fail.
- Added `BillingIngestionBatch.updatedAt`, atomic inactive-parent cleanup, and a heartbeat after every inserted chunk.
- Final review found a stale-check/delete TOCTOU; observed its regression assertion fail, then moved the heartbeat cutoff into the atomic delete predicate and checked the delete count.
- Final full suite exposed one stale source-string assertion in `test-billing-active-source`; updated it to require the stronger id + inactive + heartbeat-cutoff predicate.
- Production API stress passed, but Vercel logs exposed an ADC error hidden behind a successful GCP test response.
- Added and observed a failing auth-order regression, then changed APPLICATION_DEFAULT to prefer configured environment service-account credentials before ADC.
- Applied the heartbeat migration; production schema is current at 12 migrations.
- Pushed commits `accd705` and `2f521ce` to `origin/master` and verified deployment `dpl_FLkeXDFJdzrutbSvfW3DWyWLk7zJ` is Ready on `https://siger-bill.vercel.app`.
- Production API stress: 25 concurrent authenticated endpoints returned 200 JSON; all 10 customer monthly filters returned 200.
- Real BigQuery pull completed 81,689 rows with chunk heartbeats and activation; then the new QA batch was deleted and the previous active batch restored.
- Browser verification: login plus 19 main pages passed, monthly all customers showed 2,901 rows, testbt showed 222 rows, GCP page showed 81,689 sync rows, and application console errors were 0.
- Final residue: QA audits 0, rolled-back batch 0, original active batch restored, active non-idle DB queries 0, latest Vercel error logs empty.
- **Status:** complete

## Session: 2026-06-08

### Neon To Cloud SQL Migration
- **Status:** complete
- Actions taken:
  - Started migration plan for Neon to GCP PostgreSQL.
  - Loaded prior repo memory for bill-system GCP/Vercel/Prisma context.
  - Reused existing planning files for the new database migration task.
  - Confirmed `.env` database URLs point to Neon.
  - Confirmed runtime and seed scripts currently use the Neon Prisma adapter.
  - Confirmed local GCP project is `project-260428-1` and Cloud SQL Admin API is not enabled.
  - Enabled Cloud SQL Admin API.
  - Created Cloud SQL PostgreSQL instance `sieger-billing-pg`.
  - Created Cloud SQL database `sieger_billing` and user `sieger_app`.
  - Granted schema/database privileges and verified `sieger_app` can create/drop tables.
  - Installed local `postgresql@17` client tools.
  - Dumped Neon to `/private/tmp/sieger-db-migration-2026-06-07T17-11-06-052Z/neon-final.dump`.
  - Restored dump into Cloud SQL.
  - Compared exact row counts for all 37 public tables: 0 mismatches.
  - Replaced Neon Prisma adapter usage with PostgreSQL adapter in runtime and seed scripts.
  - Updated local `.env` database variables to Cloud SQL, after backup.
  - Updated Vercel database environment variables to Cloud SQL.
  - Patched Cloud SQL instance to `ENCRYPTED_ONLY`.
  - Committed and pushed `805fb85` to `master`.
  - Verified Vercel deployment for `805fb85` reached Ready.
  - Verified production login and `/api/me` returned 200.
  - Verified production login updated Cloud SQL `last_login_at` while Neon did not change.
  - Verified production BigQuery connection test still succeeds and finds 4 billing accounts.
  - Removed temporary Cloud SQL password files from `/private/tmp`.

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Env inspection | `.env` keys only / parsed URL metadata | Identify current provider without leaking secrets | Neon pooler and unpooled hosts confirmed | Pass |
| Cloud SQL connection | `sieger_app` to `sieger_billing` | SSL connection succeeds | Connected to Postgres 17.9 | Pass |
| Cloud SQL DDL permission | create/drop temp table | App user can restore schema | Succeeded | Pass |
| Neon vs Cloud SQL counts | 37 public tables | 0 mismatches | 0 mismatches | Pass |
| TDD red | Cloud SQL URL through Neon adapter | Query fails | Failed with `ErrorEvent` | Pass |
| TDD green | Cloud SQL URL through PostgreSQL adapter | Query succeeds | `user-count 2` | Pass |
| Local `.env` Prisma query | Cloud SQL URL from `.env` | Query succeeds | `user-count 2` | Pass |
| `npm run db:generate` | PostgreSQL adapter dependencies | Generate succeeds | Succeeded | Pass |
| `npm run build` | PostgreSQL adapter code | Production build succeeds | Succeeded | Pass |
| Vercel deploy | Commit `805fb85` | Production deploy reaches Ready | Ready in Vercel | Pass |
| Production login cutover proof | Login as admin | Cloud SQL changes, Neon unchanged | Cloud changed; Neon unchanged | Pass |
| Production BigQuery connection | `/api/admin/gcp-connections/.../test-bigquery` | GCP config reads from new DB and BigQuery works | 200 OK, 4 accounts | Pass |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-06-08 | `gcloud sql instances list` failed because Cloud SQL Admin API is disabled | 1 | Enable `sqladmin.googleapis.com` before listing/creating instances |
| 2026-06-08 | First Cloud SQL create rejected `db-f1-micro` because default edition was Enterprise Plus | 1 | Re-ran with `--edition=enterprise` |
| 2026-06-08 | Cloud SQL restricted `postgres` role could not change database owner to `sieger_app` | 1 | Granted DB/schema privileges and verified DDL as `sieger_app` |
| 2026-06-08 | TDD red command initially failed because shell expanded `$disconnect` | 1 | Re-ran with single-quoted TypeScript command |
| 2026-06-08 | `sslmode=require` failed certificate verification through `pg` | 1 | Used `sslmode=no-verify` and enforced encrypted-only on Cloud SQL |
| 2026-06-08 | Vercel rotate button stayed disabled | 1 | Filled rotate notes and checked same-value acknowledgement for Development |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Migration verified; Neon no longer active for production |
| Where am I going? | Monitor Cloud SQL-backed production; Neon can be deleted later after user confirms stability |
| What's the goal? | Make the app use GCP PostgreSQL instead of Neon |
| What have I learned? | Cloud SQL works with PrismaPg and `sslmode=no-verify`; production now writes to Cloud SQL, not Neon |
| What have I done? | Provisioned Cloud SQL, migrated data, changed Prisma adapter, updated Vercel env, deployed and verified production uses Cloud SQL |

## Session: 2026-07-09

### Full Manual Functional QA And Billing Error Fixes
- **Status:** complete
- Actions taken:
  - Reproduced and fixed monthly billing/client JSON resilience issues from the reported screenshots.
  - Created a temporary Cloud SQL QA database for destructive/manual verification and dropped it after the final pass.
  - Re-ran from the beginning after every observed browser/API/setup failure.
  - Fixed user list `next-intl` `INSUFFICIENT_PATH` by separating the roles table label from nested role-name messages.
  - Fixed expected unauthenticated `/me` 401 console noise in `AuthContext`.
  - Added bounded Cloud SQL transient retry handling for auth context, Prisma client operations, and seed scripts.
  - Fixed mock seed project bindings to create `ProjectBillingConfig` rows and bind `CustomerProject.projectId` to GCP project IDs.
  - Fixed `/api/invoice-runs/[id]` dynamic param handling to use `context.params.id`.
  - Verified login, 19 main pages, 5 detail pages, 28 read API endpoints, corrected monthly billing all/customer filters, and create flows for customer/user/billing account/SKU group/pricing list/special rule.
  - Confirmed browser console error count was 0 and server log had no new errors in the final pass.
  - Confirmed all temporary QA data was rolled back by dropping the QA database and removing temp QA files.

## Test Results - 2026-07-09
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Browser login | Dashboard loads | Dashboard loaded, console errors 0 | Pass |
| Main page sweep | 19 pages load with no error text | 19/19 passed, console errors 0 | Pass |
| Detail page sweep | 5 detail pages load | 5/5 passed, console errors 0 | Pass |
| API smoke | Read APIs return JSON 2xx with valid params | 28 endpoints passed after correcting smoke query params | Pass |
| Monthly billing all/customer | Both return 200 JSON | Both returned 200 | Pass |
| Mutating smoke | Core creates return 201 | Customer, user, billing account, SKU group, pricing list, special rule passed | Pass |
| Regression scripts | All pass | All listed scripts passed | Pass |
| Build | Production build succeeds | `npm run build` passed | Pass |
| Rollback | No QA data remains | QA DB dropped; temp files removed; no `sieger_billing_qa_*` DB remains | Pass |
