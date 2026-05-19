-- =============================================================================
-- Project binding refactor (2026-05-19)
-- =============================================================================
--
-- Goal: ProjectBillingConfig becomes the project "registry" (one row per
-- GCP project), CustomerProject stays as the customer ↔ project binding but
-- its project_id column changes from UUID FK→projects.id to VARCHAR(100)
-- FK→project_billing_configs.project_id.
--
-- Pre-migration counts (verified 2026-05-19):
--   customer_projects:       9 rows (all is_active=true, no orphans)
--   project_billing_configs: 0 rows (b5651eb added the table but unused)
--   projects:                9 rows
--
-- Run with:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
--        -f prisma/migrations/manual/2026-05-19_project-binding-refactor.sql
--
-- Wrapped in a single transaction. Sanity checks at the end RAISE EXCEPTION
-- on any inconsistency, which aborts the COMMIT.

BEGIN;

-- =============================================================================
-- 1. project_billing_configs → project registry
-- =============================================================================

-- 1a. Add new columns (nullable; backfilled in step 2)
ALTER TABLE project_billing_configs
  ADD COLUMN name               VARCHAR(255),
  ADD COLUMN billing_account_id UUID;

-- 1b. Drop the per-customer FK (customer_id → customers.id)
ALTER TABLE project_billing_configs
  DROP CONSTRAINT project_billing_configs_customer_id_fkey;

-- 1c. Drop the composite (project_id, customer_id) unique
--     NOTE: prisma db push creates @@unique as a UNIQUE INDEX (not a constraint),
--     so we drop it as an index. Same applies to step 3d below.
DROP INDEX project_billing_configs_project_id_customer_id_key;

-- 1d. Drop the per-customer index and the standalone project_id index
--     (project_id will get a new unique index below)
DROP INDEX project_billing_configs_customer_id_idx;
DROP INDEX project_billing_configs_project_id_idx;

-- 1e. Drop customer_id column
ALTER TABLE project_billing_configs
  DROP COLUMN customer_id;

-- 1f. Add new project-level uniqueness on project_id alone.
--     Use CREATE UNIQUE INDEX (not ALTER TABLE ADD CONSTRAINT) to match
--     Prisma's db-push output exactly — avoids spurious drift reports.
CREATE UNIQUE INDEX project_billing_configs_project_id_key
  ON project_billing_configs (project_id);

-- 1g. FK to billing_accounts
ALTER TABLE project_billing_configs
  ADD CONSTRAINT project_billing_configs_billing_account_id_fkey
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(id) ON DELETE SET NULL;

-- 1h. Index the new billing_account_id column
CREATE INDEX project_billing_configs_billing_account_id_idx
  ON project_billing_configs (billing_account_id);

-- =============================================================================
-- 2. Backfill project_billing_configs from the existing projects table.
-- Every project the system knows about gets a registry row; name and
-- billing_account_id are seeded from the GCP cache (Project.name / Project.billing_account_id)
-- so we don't start from NULL. User can edit the business-side name later.
-- =============================================================================

INSERT INTO project_billing_configs
  (id, project_id, name, billable, billing_account_id, created_at, updated_at)
SELECT
  gen_random_uuid(),
  p.project_id,
  p.name,
  TRUE,
  p.billing_account_id,
  NOW(),
  NOW()
FROM projects p
ON CONFLICT (project_id) DO NOTHING;

-- =============================================================================
-- 3. customer_projects.project_id: UUID → VARCHAR(100)
--    Use the explicit add-column / fill / swap pattern (safer than ALTER TYPE
--    USING with a correlated subquery — clearer intent, easier to debug).
-- =============================================================================

-- 3a. Stage a new VARCHAR column
ALTER TABLE customer_projects
  ADD COLUMN project_id_new VARCHAR(100);

-- 3b. Populate it from the projects table (UUID → GCP string)
UPDATE customer_projects cp
SET project_id_new = p.project_id
FROM projects p
WHERE p.id = cp.project_id;

-- 3c. Mid-migration assertion: no row left with a NULL translation
DO $$
DECLARE
  null_count BIGINT;
BEGIN
  SELECT count(*) INTO null_count FROM customer_projects WHERE project_id_new IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'customer_projects has % rows that could not be translated UUID → VARCHAR (no matching projects row)', null_count;
  END IF;
END $$;

-- 3d. Drop constraints/indexes that reference the old UUID project_id column.
--     The FK is a real constraint; the composite @@unique is a unique index
--     (see note in step 1c). The @@index is a plain index.
ALTER TABLE customer_projects DROP CONSTRAINT customer_projects_project_id_fkey;
DROP INDEX customer_projects_customer_id_project_id_start_date_key;
DROP INDEX customer_projects_project_id_is_active_idx;

-- 3e. Swap old column for new
ALTER TABLE customer_projects DROP COLUMN project_id;
ALTER TABLE customer_projects RENAME COLUMN project_id_new TO project_id;

-- 3f. Make project_id NOT NULL (it was on the old column, restore it)
ALTER TABLE customer_projects ALTER COLUMN project_id SET NOT NULL;

-- 3g. Recreate constraints/indexes on the new column.
--     Composite @@unique → CREATE UNIQUE INDEX (matches Prisma db push output).
CREATE UNIQUE INDEX customer_projects_customer_id_project_id_start_date_key
  ON customer_projects (customer_id, project_id, start_date);

CREATE INDEX customer_projects_project_id_is_active_idx
  ON customer_projects (project_id, is_active);

-- 3h. New FK: customer_projects.project_id → project_billing_configs.project_id
ALTER TABLE customer_projects
  ADD CONSTRAINT customer_projects_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES project_billing_configs(project_id)
  ON DELETE RESTRICT;

-- =============================================================================
-- 4. Final sanity checks before COMMIT.
--    Any failure RAISEs EXCEPTION → transaction aborts, schema unchanged.
-- =============================================================================

-- 4a. Every customer_projects.project_id resolves in project_billing_configs
DO $$
DECLARE
  orphan_count BIGINT;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM customer_projects cp
  LEFT JOIN project_billing_configs pbc ON pbc.project_id = cp.project_id
  WHERE pbc.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'customer_projects has % rows whose project_id is missing from project_billing_configs', orphan_count;
  END IF;
END $$;

-- 4b. customer_projects row count unchanged (no rows lost in the column swap)
DO $$
DECLARE
  cp_count BIGINT;
BEGIN
  SELECT count(*) INTO cp_count FROM customer_projects;
  IF cp_count <> 9 THEN
    RAISE EXCEPTION 'customer_projects row count is % (expected 9 per pre-migration baseline)', cp_count;
  END IF;
END $$;

-- 4c. project_billing_configs has at least one row per project
DO $$
DECLARE
  pbc_count BIGINT;
  proj_count BIGINT;
BEGIN
  SELECT count(*) INTO pbc_count FROM project_billing_configs;
  SELECT count(*) INTO proj_count FROM projects;
  IF pbc_count < proj_count THEN
    RAISE EXCEPTION 'project_billing_configs (%) < projects (%) after backfill', pbc_count, proj_count;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Post-commit verification (run manually after this script finishes):
--   \d project_billing_configs       -- should show name + billing_account_id + unique on project_id alone
--   \d customer_projects             -- project_id column should be character varying(100)
--   SELECT count(*) FROM project_billing_configs;  -- expect ≥ 9
--   SELECT count(*) FROM customer_projects;        -- expect 9
-- =============================================================================
