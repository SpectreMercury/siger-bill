# Billing Configuration Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Project billing-config import/template/customer/charge-type support, pricing-list Billing ID scoping, the `SUBSCRIPTION_BENEFIT` credit type, and an explicit Cost/List-price selector for historical monthly bills.

**Architecture:** Keep the existing `billable` boolean for invoice compatibility and add a richer `chargeType` enum whose `BILLABLE` value maps to `billable=true`; all other charge classifications map to `false`. Store pricing Billing IDs as external GCP billing-account strings on `PricingList`, with an empty array meaning “all”, then apply that scope when monthly rows and invoice inputs are selected. Put workbook parsing and scope matching in small pure modules so the behavior can be tested before route/UI integration.

**Tech Stack:** Next.js 14 App Router, TypeScript strict mode, Prisma 7/PostgreSQL, Zod, SheetJS (`xlsx`), React 18, next-intl.

---

### Task 1: Add failing domain tests

**Files:**
- Create: `scripts/test-project-billing-config-import.ts`
- Create: `scripts/test-pricing-billing-account-scope.ts`
- Modify: `scripts/test-monthly-billing-template.ts`
- Modify: `package.json`

**Step 1: Write the failing Project import test**

Assert that the workbook parser accepts the exported columns `Project ID`, `名称`, `客户名称`, `收费类型`, and `Billing ID`, normalizes `CUD`/`POC`/`STARTUP`, rejects duplicate Project IDs, and preserves optional cells as `null`.

**Step 2: Run it to verify RED**

Run: `npm run test:project-billing-import`

Expected: FAIL because `src/lib/project-billing-configs/workbook.ts` does not exist.

**Step 3: Write the failing pricing-scope test**

Assert:

```ts
matchesPricingBillingAccount([], 'BILL-1') === true
matchesPricingBillingAccount(['BILL-1', 'BILL-2'], 'BILL-2') === true
matchesPricingBillingAccount(['BILL-1'], 'BILL-3') === false
```

**Step 4: Run it to verify RED**

Run: `npm run test:pricing-billing-scope`

Expected: FAIL because the scope helper does not exist.

**Step 5: Add explicit monthly-template-basis assertions**

Extend the existing monthly template script to prove an explicitly requested `STANDARD` basis uses `STANDARD_TEMPLATE_HEADERS`, while `COST` uses `COST_TEMPLATE_HEADERS` and imports validate against the selected header set.

### Task 2: Extend the database model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260722000100_billing_configuration_enhancements/migration.sql`

**Step 1: Add Project charge classification**

Add:

```prisma
enum ProjectChargeType {
  BILLABLE
  NON_BILLABLE
  CUD
  POC
  STARTUP
}
```

Add `chargeType ProjectChargeType @default(BILLABLE) @map("charge_type")` to `ProjectBillingConfig`. Backfill from the current `billable` flag in SQL.

**Step 2: Add pricing Billing IDs**

Add `billingAccountIds String[] @default([]) @map("billing_account_ids")` to `PricingList`. `[]` is the durable representation of “all Billing IDs”.

**Step 3: Add credit type**

Append `SUBSCRIPTION_BENEFIT` to `CreditType` and use PostgreSQL `ALTER TYPE ... ADD VALUE IF NOT EXISTS` in the migration.

**Step 4: Generate Prisma client**

Run: `npm run db:generate`

Expected: Prisma Client generation exits 0.

### Task 3: Implement Project workbook and API behavior

**Files:**
- Create: `src/lib/project-billing-configs/workbook.ts`
- Create: `src/lib/project-billing-configs/charge-type.ts`
- Create: `src/app/api/project-billing-configs/template/route.ts`
- Create: `src/app/api/project-billing-configs/import/route.ts`
- Modify: `src/app/api/project-billing-configs/route.ts`
- Modify: `src/app/api/project-billing-configs/[id]/route.ts`

**Step 1: Implement the minimum workbook parser/generator**

Use one worksheet, exact exported headers, trimmed strings, case-insensitive charge types, and duplicate detection with row-numbered errors. Generate an empty template with a second example row so Excel users can see accepted values.

**Step 2: Run the Project import test to verify GREEN**

Run: `npm run test:project-billing-import`

Expected: PASS.

**Step 3: Extend list filtering and response mapping**

Accept `chargeType=BILLABLE|NON_BILLABLE|CUD|POC|STARTUP`, include `chargeType`, and retain the existing `boundCustomers` response.

**Step 4: Add optional customer association to create/update**

Accept `customerId?: UUID|null`, verify the customer, enforce the existing one-active-customer-per-project rule, and create/replace the `CustomerProject` binding inside the same transaction as the config mutation.

**Step 5: Implement import route**

Resolve customer name/external ID and Billing ID to existing rows, reject ambiguous or unknown values with Excel row numbers, create or update configs in one transaction, synchronize optional customer bindings, and audit the import summary.

**Step 6: Implement template route**

Return `.xlsx` bytes with the correct content type and content disposition.

### Task 4: Implement Project billing-config UI

**Files:**
- Modify: `src/app/(console)/admin/project-billing-configs/page.tsx`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`

**Step 1: Add the customer and charge type fields**

Replace the boolean radio group with a five-value charge-type select. Add an optional searchable customer select; send `customerId` and `chargeType` in create/update payloads.

**Step 2: Add table content and filters**

Render all active customer names in a Customer column. Add a charge-type filter next to the existing customer filter and send it to the list API.

**Step 3: Add import controls**

Add separate `下载模板` and `导入 Excel` buttons, a hidden `.xlsx` input, loading/error/success feedback, and refresh the table after a successful import.

### Task 5: Implement pricing-list Billing ID scoping

**Files:**
- Create: `src/lib/pricing/billing-account-scope.ts`
- Modify: `src/lib/utils/validation.ts`
- Modify: `src/app/api/pricing-lists/route.ts`
- Modify: `src/app/api/pricing-lists/[id]/route.ts`
- Modify: `src/app/api/customers/[id]/pricing-lists/route.ts`
- Modify: `src/app/(console)/admin/pricing-lists/page.tsx`
- Modify: `src/app/(console)/admin/pricing-lists/[id]/page.tsx`
- Modify: `src/lib/client/types.ts`
- Modify: `src/lib/invoice-presentation/exporters/xlsx.ts`
- Modify: `src/lib/billing/engine.ts`
- Modify: `src/lib/billing/unified-engine.ts`

**Step 1: Implement and verify the pure matcher**

Normalize whitespace, treat an empty configured array as all, and require exact Billing ID matches otherwise.

Run: `npm run test:pricing-billing-scope`

Expected: PASS.

**Step 2: Persist and expose the scope**

Accept a unique array of strings on create/update, return it from list/detail/customer endpoints, and include it in audit snapshots.

**Step 3: Add the multi-select UI**

Load `/billing-accounts`, provide an `所有 Billing ID` mode plus checkbox-style multi-select for one or more external IDs, and show the selected scope in list/detail pages.

**Step 4: Apply scope to monthly data**

While building monthly rows, discard a customer’s merged groups whose `accountId` does not match that customer’s active pricing list scope. Compute pagination after filtering.

**Step 5: Apply scope to invoice inputs**

Load the selected active list consistently and add its Billing IDs to the `RawCostEntry`/`BillingLineItem` query filters before totals, rules, credits, and snapshots are calculated.

### Task 6: Add `SUBSCRIPTION_BENEFIT` Credits support

**Files:**
- Modify: `src/components/admin/CustomerCreditsTab.tsx`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `scripts/test-billing-credit-fields.ts`

**Step 1: Add a failing enum/source assertion**

Assert the Prisma enum and UI option contain `SUBSCRIPTION_BENEFIT`.

**Step 2: Run it to verify RED**

Run the existing credit field script and confirm the missing type causes failure.

**Step 3: Add the UI option and translations**

Use the exact enum value `SUBSCRIPTION_BENEFIT`; existing Zod validation based on the Prisma enum will then accept it.

**Step 4: Re-run to verify GREEN**

Run: the repository’s credit field/type script.

Expected: PASS.

### Task 7: Add explicit historical-bill basis selection

**Files:**
- Modify: `src/app/(console)/admin/monthly-billing/page.tsx`
- Modify: `src/app/api/billing/monthly-lines/route.ts`
- Modify: `src/app/api/billing/monthly-lines/export/route.ts`
- Modify: `src/app/api/billing/monthly-lines/overrides/route.ts`
- Modify: `src/lib/billing/monthly-overrides.ts`
- Modify: `src/lib/invoice-presentation/exporters/xlsx.ts`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`

**Step 1: Thread an explicit basis through read/export**

Accept `priceBasis=STANDARD|COST`, validate it at the API edge, and pass it to the builder. When explicit, use the requested header/template for all selected customers instead of raising the mixed-template error.

**Step 2: Validate override imports against the selected basis**

Accept the basis in multipart form data, pass it to the parser/create function, and return a row/header error if the uploaded workbook belongs to the other template.

**Step 3: Add the UI selector**

Add a compact `列表价 / Cost` segmented selection to the filters, and include the selected value in browse, export, and upload requests.

**Step 4: Run monthly billing tests**

Run: `npm run test:monthly-billing-template`

Expected: PASS with both template header sets and explicit-basis checks.

### Task 8: Verify the complete change

**Files:**
- Review: all files above

**Step 1: Run targeted tests**

Run all new and touched billing/credit test scripts. Expected: all exit 0.

**Step 2: Validate Prisma**

Run: `npx prisma validate`

Expected: schema valid.

**Step 3: Run lint**

Run: `npm run lint`

Expected: exit 0, or report exact pre-existing failures separately from new failures.

**Step 4: Run production build**

Run: `npm run build`

Expected: exit 0.

**Step 5: Review the requirement checklist and diff**

Confirm every requested field, filter, template route, scope behavior, enum value, and explicit monthly-bill selector is present, and confirm unrelated dirty changes were preserved.
