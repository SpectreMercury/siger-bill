# Credit Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow authorized administrators to edit a customer credit's dates, status, total amount, remaining balance, carry-over flag, description, types, and optional matching scope.

**Architecture:** Extend the existing credit PATCH validation and route so all editable fields are validated together and audited. Reuse `CustomerCreditsTab`'s existing controlled form and SKU-group data for an edit modal, keeping create and edit payloads explicit. Preserve customer scope checks and require `remainingAmount <= totalAmount` with status/balance consistency.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Zod, Prisma/PostgreSQL, existing UI components.

---

### Task 1: Credit update validation

**Files:**
- Modify: `src/lib/utils/validation.ts`
- Modify: `scripts/test-credit-optional-amount.ts`

1. Add failing assertions that `updateCreditSchema` accepts `validFrom`, `types`, `totalAmount`, `remainingAmount`, and the existing editable fields while rejecting negative amounts.
2. Run `npm run test:credit-validation` and confirm the new update assertions fail.
3. Extend `updateCreditSchema` with the required optional fields.
4. Re-run the test and confirm it passes.

### Task 2: Safe audited PATCH behavior

**Files:**
- Create: `src/lib/credits/update.ts`
- Modify: `src/app/api/credits/[id]/route.ts`
- Create: `scripts/test-credit-update.ts`
- Modify: `package.json`

1. Write failing pure-function tests for date validation, `remainingAmount <= totalAmount`, ACTIVE requiring positive remaining balance, and DEPLETED requiring zero balance.
2. Run the new test and confirm it fails because the update builder does not exist.
3. Implement a pure update builder that merges the existing credit with the submitted patch and returns normalized Prisma update data or a specific validation error.
4. Use the builder from PATCH, validate referenced SKU groups, update the credit, and include every changed field in the existing audit event.
5. Run both credit tests and confirm they pass.

### Task 3: Customer Credits edit interface

**Files:**
- Modify: `src/lib/client/types.ts`
- Modify: `src/components/admin/CustomerCreditsTab.tsx`

1. Extend the client `Credit` type with status, currency, and carry-over fields already returned by the API.
2. Add an Edit action guarded by `credits:update`.
3. Reuse a controlled modal form prefilled from the selected credit. Include types, total, remaining, valid-from, valid-to, status, carry-over, description, SKU, SKU group, and project filters.
4. Submit with `api.patch`, close only on success, show structured API errors, and refetch the list after saving.
5. Keep Ledger as a separate action and display the actual status rather than deriving it only from `isActive`.

### Task 4: Verification and production rollout

**Files:**
- Verify all files above.

1. Run `npm run test:credit-validation` and `npm run test:credit-update`.
2. Run `npm run lint` and `npm run build`.
3. Deploy to the existing Vercel production project.
4. Use the live API to edit a disposable/no-op field round trip or submit the current values for an existing credit, verify HTTP 200 and unchanged monetary data, then inspect Vercel logs.
5. Confirm the production Credits tab displays Edit and the current `se`/`sw` balances without mutating them.
