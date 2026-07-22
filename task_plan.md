# Task Plan: Migrate Neon Database To GCP PostgreSQL

---

# Task Plan: Production Regression QA And Redeploy - 2026-07-13

## Goal
Re-test the deployed Sieger console end to end, identify any visible errors or behavior that does not match expected billing/admin workflows, fix every reproducible defect test-first, deploy the resulting code, and verify the final production state with no QA residue.

## Current Phase
Complete

## Phases

### Phase 1: Baseline And Test Inventory
- [x] Confirm current branch, deployment, schema, and working-tree scope
- [x] Run existing regression scripts, lint/build, and production API baseline
- [x] Inventory browser pages and safe mutation workflows
- **Status:** complete

### Phase 2: Production Read-Only And Billing Verification
- [x] Login, navigation, main lists, and detail pages
- [x] Monthly billing all customers and every current customer filter
- [x] GCP connection and BigQuery tests
- [x] Confirm browser console and API responses contain no reported errors
- **Status:** complete

### Phase 3: Safe Mutation And Sync Verification
- [x] Execute production API and BigQuery sync flows with unique QA markers
- [x] Execute real billing pull with inactive load, heartbeat, and final activation
- [x] Remove all QA audits and restore the pre-test active billing batch
- **Status:** complete

### Phase 4: Fix And Restart If Needed
- [x] For each defect, record root cause and add a failing regression test
- [x] Apply the minimal fix and rerun from Phase 1
- **Status:** complete

### Phase 5: Deploy And Final Production Pass
- [x] Run complete regression suite, lint, build, and migration status
- [x] Deploy production and confirm deployment is Ready
- [x] Repeat production API/browser/data-state checks
- [x] Confirm zero QA residue and report any residual risk explicitly
- **Status:** complete

## Hard Rules
- Any reproducible application error restarts the verification sequence from Phase 1 after its fix.
- Do not overwrite or delete real customer/billing data; temporary records must use a unique QA marker and be cleaned.
- Do not expose credentials or database connection strings in logs or reports.

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `test-billing-active-source` rejected any batch `deleteMany` call | 1 | Root cause was a stale over-broad source assertion. Production cleanup is scoped to the current incomplete inactive batch; updated the regression contract to allow only `id + isActive:false` cleanup and forbid same-source history deletion. |
| `npm run lint` opened an interactive setup prompt | 1 | The repo had ESLint 9 and `eslint-config-next` 16 but still used Next 14's `next lint` with no config. Added the supported flat config and changed the script to non-interactive `eslint .`. |
| Production `/api/me` returned 500 and all later pages redirected to login | 1 | Vercel log proved Prisma `P2037 TooManyConnections`. Each serverless instance defaulted to a 5-connection pool, `P2037` was not retried, and AuthContext cleared the token for every `/me` error. Added red tests for all three causes before implementation. |
| Direct PostgreSQL diagnostics were rejected | 1 | Cloud SQL reported all ordinary connection slots exhausted, independently confirming the Vercel `P2037` evidence. Plan is deploy the one-connection pool fix, restart Cloud SQL to clear stale pools, then rerun production verification. |
| Independent review found unsafe global write retries and billing sync races | 1 | Accepted findings. Added new red tests to forbid global Prisma retries, bound active-batch reuse by freshness, protect in-progress batches with a stale lease, and make transient auth failures recoverable instead of permanent Loading. |
| Second review found non-atomic incomplete cleanup and non-renewing lease | 1 | Added red tests requiring inactive-parent atomic delete via cascade and an `updatedAt` heartbeat renewed after each chunk. |
| Final review found lease-check/delete TOCTOU | 1 | Added a red assertion requiring the stale cutoff in the atomic parent delete and requiring its delete count to be checked. |
| GCP connection test logged ADC credential errors despite a 200 response | 1 | Production Vercel has `GCP_SERVICE_ACCOUNT_JSON`, but `APPLICATION_DEFAULT` tried ADC first. Added a red regression test requiring env service-account auth before ADC. |

---

# Task Plan: Full Manual Functional QA

## Goal
Manually execute the console's key user-facing flows end to end against the local app at `http://localhost:3000`, covering page navigation, data loading, filters, exports/tests, safe CRUD paths, and billing/GCP workflows. Any visible browser error, non-JSON API failure, 4xx/5xx regression, timeout, or broken UI state must be investigated, fixed, and retested.

## Hard Rules
- If any error occurs during a pass, stop the pass, investigate and fix root cause, reset to a clean QA database state, then rerun from Phase 1.
- Do not mutate the real active database during QA. Clone the current database into a temporary QA database, run the local app against that clone, and drop the QA database at the end.

## Current Phase
Phase 1

## Phases

### Phase 1: Scope And Harness
- [ ] Stop any server connected to the real database
- [ ] Clone the current database into a temporary QA database
- [ ] Start local server against the QA database
- [ ] Discover available pages, menus, and API-backed workflows
- [ ] Set up browser-driven checks with console/network capture
- **Status:** in_progress

### Phase 2: Read-Only Navigation And Loading
- [ ] Login and dashboard
- [ ] All sidebar/menu pages
- [ ] Lists, detail pages, pagination/search/filter controls where present
- **Status:** pending

### Phase 3: Safe Mutating Workflows
- [ ] Use `QA_`/`Codex QA` temporary records only
- [ ] Create/edit/delete/cleanup flows that do not alter real business records
- [ ] Verify no leftover QA data unless needed for cleanup proof
- **Status:** pending

### Phase 4: Billing And GCP Workflows
- [ ] Monthly billing all customers and each selectable customer
- [ ] BigQuery connection test
- [ ] Billing sync/job status behavior
- [ ] Excel export / override validation path where safe
- **Status:** pending

### Phase 5: Regression Verification
- [ ] Build and scripted regression tests
- [ ] Final browser/API pass after any fixes
- [ ] Drop the temporary QA database after all checks pass
- [ ] Summarize remaining risks if any
- **Status:** pending

## Final QA Result - 2026-07-09
- [x] Rebuilt QA database from scratch after every observed error.
- [x] Final login passed with 0 browser console errors.
- [x] Final main-page sweep passed across 19 pages.
- [x] Final detail-page sweep passed across 5 detail pages.
- [x] Final API smoke passed with corrected route parameters.
- [x] Final monthly billing all-customer and customer-filter calls returned 200.
- [x] Final mutating smoke passed for customer, user, billing account, SKU group, pricing list, and special rule creation.
- [x] Final scripted regression tests and production build passed.
- [x] Temporary QA database was dropped and temp QA files were removed.
- **Status:** complete

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|

## Goal
Move the current production database from Neon PostgreSQL to a GCP-hosted PostgreSQL database, update the app deployment to use the new database, verify production behavior, and leave Neon unused but recoverable until the cutover is confirmed.

## Current Phase
Phase 5

## Phases

### Phase 1: Discovery And Backup
- [x] Confirm current Prisma/database setup and deployment target
- [x] Identify current Neon connection without exposing secrets
- [x] Confirm GCP project/region and available Cloud SQL APIs
- [x] Create a safe backup/export path before any cutover
- **Status:** complete

### Phase 2: Provision GCP PostgreSQL
- [x] Create or select a Cloud SQL PostgreSQL instance
- [x] Create app database/user
- [x] Configure network access suitable for Vercel
- [x] Record connection details securely
- **Status:** complete

### Phase 3: Data Migration
- [x] Dump Neon database
- [x] Restore into Cloud SQL PostgreSQL
- [x] Run consistency checks on key tables/counts
- [x] Verify Prisma can connect to the GCP database
- **Status:** complete

### Phase 4: App Cutover
- [x] Update local env for verification
- [x] Update Vercel production/preview database env vars
- [x] Commit and push PostgreSQL adapter code
- [x] Redeploy production
- [x] Smoke test login and key APIs
- **Status:** complete

### Phase 5: Deprecate Neon
- [x] Keep a timestamped final Neon dump
- [x] Confirm production is using GCP database
- [x] Remove Neon env references from active deployment
- [x] Do not delete Neon resources until the user confirms post-cutover stability
- **Status:** complete

## Key Constraints
- Do not print database URLs, passwords, or dumps.
- Do not delete Neon until the GCP-backed production app is verified.
- Avoid destructive schema operations; use dump/restore and Prisma checks.
- This repo has a nonstandard `prisma/migrations/manual` directory, so avoid assuming `prisma migrate deploy` is safe without checking.

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Target GCP Cloud SQL PostgreSQL unless discovery shows an existing GCP Postgres target | It is the closest managed equivalent to Neon for Prisma/Postgres and fits the user's request to move DB to GCP. |
| Keep Neon recoverable during cutover | "废弃" should mean unused by the app first; deletion can happen after verification. |
| Use Cloud SQL public IP with `0.0.0.0/0` authorized network for this cutover | Vercel Hobby/dynamic egress has no fixed outbound IP; use SSL and strong DB password, then tighten later if static egress is available. |
| Use `sslmode=no-verify` in the app connection URL | `pg` treats `sslmode=require` as certificate verification; Cloud SQL IP connection failed certificate validation. The instance is patched to `ENCRYPTED_ONLY`, so transport is encrypted while CA verification is deferred. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `POSTGRES_17` defaulted to Enterprise Plus and rejected `db-f1-micro` | 1 | Re-created with `--edition=enterprise`, which supports `db-f1-micro`. |
| Cloud SQL `postgres` user could not `ALTER DATABASE ... OWNER TO sieger_app` | 1 | Granted database and schema privileges to `sieger_app`; verified create/drop table works. |
| `sslmode=require` failed certificate verification through `pg` | 1 | Switched URL to `sslmode=no-verify` and patched Cloud SQL to encrypted-only. |
