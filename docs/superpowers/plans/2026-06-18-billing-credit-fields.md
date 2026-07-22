# Billing Credit Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align persisted billing fields with the approved Excel COST export and make customer credits configurable by SKU scope.

**Architecture:** Extend the existing `BillingLineItem` model rather than creating a second detail table, because invoice generation and monthly export already read from this table. Normalize BigQuery fields into first-class columns at ingestion time while keeping `rawPayload` for audit replay. Reuse the existing credit scope columns and finish the missing API/UI plumbing.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma 7, PostgreSQL, BigQuery billing export, `xlsx`.

---

### Task 1: Regression Test Harness

**Files:**
- Create: `scripts/test-billing-credit-fields.ts`

- [ ] **Step 1: Write the failing test**

Create a TypeScript script that asserts:
- `CreditType` includes exactly `FEE_UTILIZATION_OFFSET`, `DISCOUNT`, `SUSTAINED_USAGE_DISCOUNT`, `COMMITTED_USAGE_DISCOUNT`, `COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE`, `PROMOTION`.
- `BillingLineItem` has first-class fields matching the COST export.
- monthly XLSX headers match the COST export order.
- customer credit create/list API persists and returns `matchSkuId`, `matchSkuGroupId`, and `matchProjectId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/test-billing-credit-fields.ts`

Expected: FAIL on missing `FEE_UTILIZATION_OFFSET` and missing billing fields.

### Task 2: Prisma Schema And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260618000100_billing_cost_export_credit_fields/migration.sql`

- [ ] **Step 1: Update CreditType enum**

Add `FEE_UTILIZATION_OFFSET` and remove `SUBSCRIPTION_BENEFIT` from the Prisma enum. Migration must convert any existing `SUBSCRIPTION_BENEFIT` array values to `DISCOUNT` before replacing the Postgres enum.

- [ ] **Step 2: Add billing detail columns**

Add first-class nullable columns for account/project/service/SKU display fields, pricing-unit usage, currency conversion, transaction type, credit breakdown, credit amount, and cost-after-credit.

- [ ] **Step 3: Generate Prisma client**

Run: `npm run db:generate`

### Task 3: BigQuery Ingestion Mapping

**Files:**
- Modify: `src/lib/billing/adapters/types.ts`
- Modify: `src/lib/billing/adapters/gcp-bigquery.ts`
- Modify: `src/lib/billing/unified-engine.ts`

- [ ] **Step 1: Extend BillingLineItemDTO**

Add optional normalized fields to the adapter DTO.

- [ ] **Step 2: Populate fields in GCP adapter**

Map the approved Excel source fields from BigQuery rows into the DTO.

- [ ] **Step 3: Persist fields during ingestion**

Include the new DTO fields in `billingLineItem.createMany`.

### Task 4: COST Export Alignment

**Files:**
- Modify: `src/lib/invoice-presentation/exporters/xlsx.ts`
- Modify: `src/app/(console)/admin/monthly-billing/page.tsx`

- [ ] **Step 1: Replace template headers**

Use the COST version header order from the approved Excel.

- [ ] **Step 2: Build rows from first-class DB columns**

Use normalized columns first, falling back to `rawPayload` only for older imported data.

### Task 5: Customer Credit SKU Scope Plumbing

**Files:**
- Modify: `src/lib/utils/validation.ts`
- Modify: `src/app/api/customers/[id]/credits/route.ts`
- Modify: `src/app/api/credits/route.ts`
- Modify: `src/app/api/credits/[id]/route.ts`
- Modify: `src/components/admin/CustomerCreditsTab.tsx`
- Modify: `src/lib/client/types.ts`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

- [ ] **Step 1: Centralize credit type validation**

Update API validation to the exact approved six-type set.

- [ ] **Step 2: Persist and return scope fields**

Customer credit create/list endpoints must accept, validate, persist, audit, and return SKU/project scope fields and SKU group relation.

- [ ] **Step 3: Update client option labels**

Replace `SUBSCRIPTION_BENEFIT` with `FEE_UTILIZATION_OFFSET`.

### Task 6: Verification

**Files:**
- All changed files

- [ ] **Step 1: Run regression test**

Run: `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/test-billing-credit-fields.ts`

- [ ] **Step 2: Run Prisma generate**

Run: `npm run db:generate`

- [ ] **Step 3: Run build**

Run: `npm run build`

- [ ] **Step 4: Review git diff**

Run: `git diff --stat && git diff --check`

### Task 7: Monthly Billing Excel Override

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260618000200_monthly_billing_overrides/migration.sql`
- Create: `src/lib/billing/monthly-overrides.ts`
- Create: `src/app/api/billing/monthly-lines/overrides/route.ts`
- Modify: `src/lib/invoice-presentation/exporters/xlsx.ts`
- Modify: `src/app/(console)/admin/monthly-billing/page.tsx`

- [ ] **Step 1: Write failing regression checks**

Extend `scripts/test-billing-credit-fields.ts` to require monthly override models, routes, importer helpers, and UI upload controls.

- [ ] **Step 2: Add override tables**

Add `BillingMonthlyOverride` and `BillingMonthlyOverrideLine`. Override batches are versioned by `(billingMonth, customerId)` with one active batch at a time.

- [ ] **Step 3: Implement upload parser**

Parse the approved COST Excel header, reject missing columns, reject locked months, store file hash and parsed lines, deactivate prior active batches, and activate the new batch.

- [ ] **Step 4: Update read/export priority**

Monthly billing list/export reads active override rows before falling back to BigQuery `billing_line_items`.

- [ ] **Step 5: Add page controls**

Add upload input and active override status to monthly billing page.
