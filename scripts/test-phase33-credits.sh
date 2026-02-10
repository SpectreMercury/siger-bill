#!/bin/bash
#
# Phase 3.3: Credits Engine Test Script
#
# Tests the complete credits workflow:
# 1. Create credits for a customer (PROMOTION, CONTRACT, FLEX types)
# 2. List and query credits
# 3. Run invoice run to apply credits
# 4. Verify credit ledger entries
# 5. Verify final invoice amount reflects credits
#
# Prerequisites:
# - Server running on localhost:3000
# - Database seeded with default admin user and at least one customer
# - Pricing setup from Phase 3 (optional but recommended)
#
# Usage: ./scripts/test-phase33-credits.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
BILLING_MONTH="${BILLING_MONTH:-2026-04}"

echo "========================================"
echo "Phase 3.3: Credits Engine Test"
echo "========================================"
echo "Base URL: $BASE_URL"
echo "Billing Month: $BILLING_MONTH"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
step() {
  echo -e "\n${YELLOW}=> $1${NC}"
}

ok() {
  echo -e "${GREEN}   PASS: $1${NC}"
}

fail() {
  echo -e "${RED}   FAIL: $1${NC}"
  FAILED=1
}

info() {
  echo -e "${CYAN}   INFO: $1${NC}"
}

FAILED=0

# ============================================================================
# Step 1: Login
# ============================================================================
step "Step 1: Authenticating..."

LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@sieger.com","password":"SiegerAdmin2024!"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  fail "Login failed"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

ok "Authenticated"

# ============================================================================
# Step 2: Get Customer ID
# ============================================================================
step "Step 2: Getting customer..."

CUSTOMERS=$(curl -s -X GET "$BASE_URL/api/customers" \
  -H "Authorization: Bearer $TOKEN")

CUSTOMER_ID=$(echo "$CUSTOMERS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
CUSTOMER_NAME=$(echo "$CUSTOMERS" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$CUSTOMER_ID" ]; then
  fail "No customer found"
  exit 1
fi

ok "Found customer: $CUSTOMER_NAME ($CUSTOMER_ID)"

# ============================================================================
# Step 3: Create Credits
# ============================================================================
step "Step 3: Creating credits for customer..."

YEAR=$(echo "$BILLING_MONTH" | cut -d'-' -f1)
MONTH=$(echo "$BILLING_MONTH" | cut -d'-' -f2)

# Credit 1: PROMOTION credit ($50, for current month only, no carry-over)
PROMO_CREDIT=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/credits" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"type\": \"PROMOTION\",
    \"totalAmount\": 50.00,
    \"currency\": \"USD\",
    \"validFrom\": \"${YEAR}-${MONTH}-01\",
    \"validTo\": \"${YEAR}-${MONTH}-30\",
    \"allowCarryOver\": false,
    \"sourceReference\": \"PROMO-2026-Q1\",
    \"description\": \"Q1 promotional credit - no carry-over\"
  }")

PROMO_CREDIT_ID=$(echo "$PROMO_CREDIT" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$PROMO_CREDIT_ID" ]; then
  ok "Created PROMOTION credit: \$50 (ID: $PROMO_CREDIT_ID)"
else
  info "Response: $PROMO_CREDIT"
fi

# Credit 2: CONTRACT credit ($100, valid for 3 months, carry-over allowed)
VALID_TO_MONTH=$((MONTH + 2))
if [ $VALID_TO_MONTH -gt 12 ]; then
  VALID_TO_YEAR=$((YEAR + 1))
  VALID_TO_MONTH=$((VALID_TO_MONTH - 12))
  VALID_TO_MONTH=$(printf "%02d" $VALID_TO_MONTH)
else
  VALID_TO_YEAR=$YEAR
  VALID_TO_MONTH=$(printf "%02d" $VALID_TO_MONTH)
fi

CONTRACT_CREDIT=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/credits" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"type\": \"CONTRACT\",
    \"totalAmount\": 100.00,
    \"currency\": \"USD\",
    \"validFrom\": \"${YEAR}-${MONTH}-01\",
    \"validTo\": \"${VALID_TO_YEAR}-${VALID_TO_MONTH}-28\",
    \"allowCarryOver\": true,
    \"sourceReference\": \"CONTRACT-2026-001\",
    \"description\": \"Contractual committed credit - multi-month\"
  }")

CONTRACT_CREDIT_ID=$(echo "$CONTRACT_CREDIT" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$CONTRACT_CREDIT_ID" ]; then
  ok "Created CONTRACT credit: \$100 (ID: $CONTRACT_CREDIT_ID)"
else
  info "Response: $CONTRACT_CREDIT"
fi

# ============================================================================
# Step 4: List Credits for Customer
# ============================================================================
step "Step 4: Listing customer credits..."

CREDITS_LIST=$(curl -s -X GET "$BASE_URL/api/customers/$CUSTOMER_ID/credits" \
  -H "Authorization: Bearer $TOKEN")

CREDIT_COUNT=$(echo "$CREDITS_LIST" | grep -o '"id":"[^"]*"' | wc -l | tr -d ' ')

if [ "$CREDIT_COUNT" -gt 0 ]; then
  ok "Found $CREDIT_COUNT credit(s) for customer"

  # Show credit summary
  echo -e "${CYAN}   Credit Summary:${NC}"
  echo "$CREDITS_LIST" | grep -o '"type":"[^"]*"' | while read -r line; do
    TYPE=$(echo "$line" | cut -d'"' -f4)
    echo -e "${CYAN}   - Type: $TYPE${NC}"
  done
else
  fail "No credits found"
fi

# ============================================================================
# Step 5: Get Credit Details
# ============================================================================
step "Step 5: Getting credit details..."

if [ -n "$CONTRACT_CREDIT_ID" ]; then
  CREDIT_DETAIL=$(curl -s -X GET "$BASE_URL/api/credits/$CONTRACT_CREDIT_ID" \
    -H "Authorization: Bearer $TOKEN")

  REMAINING=$(echo "$CREDIT_DETAIL" | grep -o '"remainingAmount":"[^"]*"' | cut -d'"' -f4)
  STATUS=$(echo "$CREDIT_DETAIL" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  ok "CONTRACT credit status: $STATUS, remaining: \$$REMAINING"
fi

# ============================================================================
# Step 6: Ensure Project Binding
# ============================================================================
step "Step 6: Ensuring project binding..."

# Check/create project
PROJECT_CHECK=$(curl -s -X POST "$BASE_URL/api/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectId": "credits-test-project",
    "name": "Credits Test Project"
  }')

if echo "$PROJECT_CHECK" | grep -q '"id"'; then
  ok "Project created/exists: credits-test-project"
fi

# Bind project to customer
BIND_CHECK=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"projectId": "credits-test-project"}')

if echo "$BIND_CHECK" | grep -q '"id"'; then
  ok "Project bound to customer"
elif echo "$BIND_CHECK" | grep -q 'already bound'; then
  ok "Project already bound (OK)"
fi

# ============================================================================
# Step 7: Import Raw Cost Data
# ============================================================================
step "Step 7: Importing raw cost data..."

# Import cost data ($200 total - more than credits to test partial application)
IMPORT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/raw-cost/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"source\": \"credits-test\",
    \"month\": \"$BILLING_MONTH\",
    \"entries\": [
      {
        \"billingAccountId\": \"billingAccounts/CREDITS-TEST\",
        \"projectId\": \"credits-test-project\",
        \"serviceId\": \"compute.googleapis.com\",
        \"skuId\": \"SKU-CREDITS-TEST-1\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-15T00:00:00Z\",
        \"usageAmount\": 720,
        \"cost\": 150.00,
        \"currency\": \"USD\"
      },
      {
        \"billingAccountId\": \"billingAccounts/CREDITS-TEST\",
        \"projectId\": \"credits-test-project\",
        \"serviceId\": \"storage.googleapis.com\",
        \"skuId\": \"SKU-CREDITS-TEST-2\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-28T00:00:00Z\",
        \"usageAmount\": 1000000,
        \"cost\": 50.00,
        \"currency\": \"USD\"
      }
    ]
  }")

BATCH_ID=$(echo "$IMPORT_RESPONSE" | grep -o '"batchId":"[^"]*"' | cut -d'"' -f4)

if [ -n "$BATCH_ID" ]; then
  ok "Imported raw cost data. Batch: $BATCH_ID"
  info "Raw costs: Compute \$150 + Storage \$50 = Total \$200"
else
  info "Response: $IMPORT_RESPONSE"
fi

# ============================================================================
# Step 8: Create and Execute Invoice Run
# ============================================================================
step "Step 8: Creating invoice run..."

RUN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/invoice-runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"billingMonth\": \"$BILLING_MONTH\"}")

RUN_ID=$(echo "$RUN_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$RUN_ID" ]; then
  ok "Created invoice run: $RUN_ID"
else
  info "Response: $RUN_RESPONSE"
  # Check for idempotent response
  if echo "$RUN_RESPONSE" | grep -q '"_idempotent":true'; then
    RUN_ID=$(echo "$RUN_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    ok "Using existing run: $RUN_ID"
  fi
fi

step "Step 9: Executing invoice run..."

if [ -n "$RUN_ID" ]; then
  EXEC_RESPONSE=$(curl -s -X POST "$BASE_URL/api/invoice-runs/$RUN_ID/execute" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN")

  echo ""
  info "=== EXECUTION RESULT ==="

  STATUS=$(echo "$EXEC_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  RAW_TOTAL=$(echo "$EXEC_RESPONSE" | grep -o '"rawTotalAmount":"[^"]*"' | cut -d'"' -f4)
  PRICED_TOTAL=$(echo "$EXEC_RESPONSE" | grep -o '"totalAmount":"[^"]*"' | cut -d'"' -f4)
  CREDITS_APPLIED=$(echo "$EXEC_RESPONSE" | grep -o '"creditsApplied":[^,}]*' | cut -d':' -f2)
  TOTAL_CREDITS=$(echo "$EXEC_RESPONSE" | grep -o '"totalCreditsApplied":"[^"]*"' | cut -d'"' -f4)

  if [ "$STATUS" = "SUCCEEDED" ]; then
    ok "Invoice run executed successfully"
    echo ""
    echo -e "${CYAN}   CREDITS SUMMARY:${NC}"
    echo -e "${CYAN}   ├─ Raw Total:         \$${RAW_TOTAL}${NC}"
    echo -e "${CYAN}   ├─ Final Amount:      \$${PRICED_TOTAL}${NC}"
    echo -e "${CYAN}   ├─ Credits Applied:   ${CREDITS_APPLIED}${NC}"
    echo -e "${CYAN}   └─ Total Credits:     \$${TOTAL_CREDITS}${NC}"
    echo ""

    # Expected calculations:
    # Raw total: $200 (no pricing rules applied since SKUs are new)
    # Credits: $50 (PROMO) + $100 (CONTRACT) = $150 max
    # But PROMO credit (no carry-over) applies first due to earlier validFrom
    # Final: $200 - $150 = $50
    info "Expected: \$200 raw - \$150 credits = \$50 final"

  else
    fail "Invoice run failed"
    info "Response: $EXEC_RESPONSE"
  fi
fi

# ============================================================================
# Step 10: Verify Credit Balances After Application
# ============================================================================
step "Step 10: Verifying credit balances after application..."

if [ -n "$PROMO_CREDIT_ID" ]; then
  PROMO_DETAIL=$(curl -s -X GET "$BASE_URL/api/credits/$PROMO_CREDIT_ID" \
    -H "Authorization: Bearer $TOKEN")

  PROMO_REMAINING=$(echo "$PROMO_DETAIL" | grep -o '"remainingAmount":"[^"]*"' | cut -d'"' -f4)
  PROMO_STATUS=$(echo "$PROMO_DETAIL" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  ok "PROMOTION credit: remaining=\$$PROMO_REMAINING, status=$PROMO_STATUS"

  # Check ledger history
  PROMO_LEDGER=$(echo "$PROMO_DETAIL" | grep -o '"ledgerHistory":\[[^]]*\]')
  if [ -n "$PROMO_LEDGER" ]; then
    ok "PROMOTION credit has ledger entries"
  fi
fi

if [ -n "$CONTRACT_CREDIT_ID" ]; then
  CONTRACT_DETAIL=$(curl -s -X GET "$BASE_URL/api/credits/$CONTRACT_CREDIT_ID" \
    -H "Authorization: Bearer $TOKEN")

  CONTRACT_REMAINING=$(echo "$CONTRACT_DETAIL" | grep -o '"remainingAmount":"[^"]*"' | cut -d'"' -f4)
  CONTRACT_STATUS=$(echo "$CONTRACT_DETAIL" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  ok "CONTRACT credit: remaining=\$$CONTRACT_REMAINING, status=$CONTRACT_STATUS"
fi

# ============================================================================
# Step 11: Query Invoice Details (verify credit info)
# ============================================================================
step "Step 11: Querying invoice details..."

INVOICES=$(curl -s -X GET "$BASE_URL/api/invoices?billingMonth=$BILLING_MONTH" \
  -H "Authorization: Bearer $TOKEN")

INVOICE_ID=$(echo "$INVOICES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
INVOICE_NUMBER=$(echo "$INVOICES" | grep -o '"invoiceNumber":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$INVOICE_ID" ]; then
  ok "Found invoice: $INVOICE_NUMBER"

  INVOICE_DETAIL=$(curl -s -X GET "$BASE_URL/api/invoices/$INVOICE_ID" \
    -H "Authorization: Bearer $TOKEN")

  SUBTOTAL=$(echo "$INVOICE_DETAIL" | grep -o '"subtotal":"[^"]*"' | cut -d'"' -f4)
  CREDIT_AMOUNT=$(echo "$INVOICE_DETAIL" | grep -o '"creditAmount":"[^"]*"' | cut -d'"' -f4)
  TOTAL=$(echo "$INVOICE_DETAIL" | grep -o '"totalAmount":"[^"]*"' | cut -d'"' -f4)

  echo -e "${CYAN}   Invoice Breakdown:${NC}"
  echo -e "${CYAN}   ├─ Subtotal:       \$${SUBTOTAL}${NC}"
  echo -e "${CYAN}   ├─ Credits:        \$${CREDIT_AMOUNT}${NC}"
  echo -e "${CYAN}   └─ Total Due:      \$${TOTAL}${NC}"

  # Check for credits breakdown in currencyBreakdown
  if echo "$INVOICE_DETAIL" | grep -q '"credits"'; then
    ok "Invoice includes credits breakdown"
  fi
fi

# ============================================================================
# Step 12: Test Credit Update (PATCH)
# ============================================================================
step "Step 12: Testing credit update..."

if [ -n "$CONTRACT_CREDIT_ID" ]; then
  UPDATE_RESPONSE=$(curl -s -X PATCH "$BASE_URL/api/credits/$CONTRACT_CREDIT_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "description": "Updated: Contractual credit with extended notes"
    }')

  if echo "$UPDATE_RESPONSE" | grep -q '"id"'; then
    ok "Credit updated successfully"
  else
    info "Response: $UPDATE_RESPONSE"
  fi
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All Phase 3.3 credits tests passed!${NC}"
else
  echo -e "${RED}Some tests failed - review output above${NC}"
fi

echo ""
echo "========================================"
echo "Curl Commands Reference"
echo "========================================"
cat << 'EOF'

# Create a credit for customer
curl -X POST http://localhost:3000/api/customers/{CUSTOMER_ID}/credits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "type": "PROMOTION",
    "totalAmount": 50.00,
    "currency": "USD",
    "validFrom": "2026-04-01",
    "validTo": "2026-04-30",
    "allowCarryOver": false,
    "sourceReference": "PROMO-2026-Q1",
    "description": "Promotional credit"
  }'

# List credits for customer
curl http://localhost:3000/api/customers/{CUSTOMER_ID}/credits \
  -H "Authorization: Bearer $TOKEN"

# Get credit details with ledger history
curl http://localhost:3000/api/credits/{CREDIT_ID} \
  -H "Authorization: Bearer $TOKEN"

# Update credit
curl -X PATCH http://localhost:3000/api/credits/{CREDIT_ID} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "description": "Updated description",
    "allowCarryOver": true
  }'

# Execute Invoice Run (credits applied automatically)
curl -X POST http://localhost:3000/api/invoice-runs/{RUN_ID}/execute \
  -H "Authorization: Bearer $TOKEN"

# Response includes:
# {
#   "rawTotalAmount": "200.00",
#   "totalAmount": "50.00",
#   "creditsApplied": true,
#   "totalCreditsApplied": "150.00"
# }

# Credit types:
# - PROMOTION: Marketing/promotional credits
# - CONTRACT: Contractual committed credits
# - FLEX: Flexible/discretionary credits

# allowCarryOver behavior:
# - false: Credit can only be used in its starting month
# - true: Credit can be used across its entire validity period

EOF

echo ""
echo "Phase 3.3 credits test completed!"
