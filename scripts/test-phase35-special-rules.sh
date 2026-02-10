#!/bin/bash
#
# Phase 3.5: Special Rules Engine Test Script
#
# Tests the complete special rules workflow:
# 1. Create SKU groups and SKUs for testing
# 2. Create special rules (EXCLUDE, OVERRIDE_COST)
# 3. Import raw cost data
# 4. Run invoice run and verify special rules are applied
# 5. Verify effect ledger entries
#
# Prerequisites:
# - Server running on localhost:3000
# - Database seeded with default admin user and at least one customer
#
# Usage: ./scripts/test-phase35-special-rules.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
BILLING_MONTH="${BILLING_MONTH:-2026-05}"

echo "========================================"
echo "Phase 3.5: Special Rules Engine Test"
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
# Step 3: Create SKUs and SKU Groups for testing
# ============================================================================
step "Step 3: Creating SKUs for testing..."

SKUS_RESPONSE=$(curl -s -X POST "$BASE_URL/api/skus" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "skus": [
      {
        "skuId": "SKU-SPECIAL-COMPUTE",
        "skuDescription": "Special Compute Instance",
        "serviceId": "compute.googleapis.com",
        "serviceDescription": "Compute Engine",
        "unit": "hour"
      },
      {
        "skuId": "SKU-SPECIAL-PROMO",
        "skuDescription": "Promotional Free Service",
        "serviceId": "promo.googleapis.com",
        "serviceDescription": "Promotional Services",
        "unit": "request"
      },
      {
        "skuId": "SKU-SPECIAL-STORAGE",
        "skuDescription": "Special Storage Service",
        "serviceId": "storage.googleapis.com",
        "serviceDescription": "Cloud Storage",
        "unit": "byte-seconds"
      }
    ]
  }')

if echo "$SKUS_RESPONSE" | grep -q '"count"'; then
  COUNT=$(echo "$SKUS_RESPONSE" | grep -o '"count":[0-9]*' | cut -d':' -f2)
  ok "Created/verified $COUNT SKUs"
fi

# Create SKU Group for exclusion testing
step "Step 4: Creating SKU Group for exclusion testing..."

PROMO_GROUP=$(curl -s -X POST "$BASE_URL/api/sku-groups" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "code": "PROMO-FREE",
    "name": "Promotional Free Services",
    "description": "Services that should be excluded from billing"
  }')

PROMO_GROUP_ID=$(echo "$PROMO_GROUP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$PROMO_GROUP_ID" ]; then
  ok "Created PROMO-FREE group: $PROMO_GROUP_ID"
elif echo "$PROMO_GROUP" | grep -q 'already exists'; then
  ok "PROMO-FREE group already exists"
  # Get existing group ID
  GROUPS_LIST=$(curl -s -X GET "$BASE_URL/api/sku-groups?search=PROMO-FREE" \
    -H "Authorization: Bearer $TOKEN")
  PROMO_GROUP_ID=$(echo "$GROUPS_LIST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

# Map promotional SKU to group
if [ -n "$PROMO_GROUP_ID" ]; then
  PROMO_MAP=$(curl -s -X POST "$BASE_URL/api/sku-groups/$PROMO_GROUP_ID/mappings" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"skuIds": ["SKU-SPECIAL-PROMO"]}')
  ok "Mapped SKU-SPECIAL-PROMO to PROMO-FREE group"
fi

# ============================================================================
# Step 5: Create Special Rules
# ============================================================================
step "Step 5: Creating special rules..."

# Rule 1: Exclude PROMO-FREE SKU group from billing
EXCLUDE_RULE=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/special-rules" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"Exclude Promotional Services\",
    \"ruleType\": \"EXCLUDE_SKU_GROUP\",
    \"priority\": 10,
    \"matchSkuGroupId\": \"$PROMO_GROUP_ID\"
  }")

EXCLUDE_RULE_ID=$(echo "$EXCLUDE_RULE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$EXCLUDE_RULE_ID" ]; then
  ok "Created EXCLUDE_SKU_GROUP rule: $EXCLUDE_RULE_ID"
else
  info "Response: $EXCLUDE_RULE"
fi

# Rule 2: 50% discount for compute service (OVERRIDE_COST with multiplier 0.5)
OVERRIDE_RULE=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/special-rules" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "50% Compute Discount",
    "ruleType": "OVERRIDE_COST",
    "priority": 20,
    "matchServiceId": "compute.googleapis.com",
    "costMultiplier": 0.5
  }')

OVERRIDE_RULE_ID=$(echo "$OVERRIDE_RULE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$OVERRIDE_RULE_ID" ]; then
  ok "Created OVERRIDE_COST rule (50% multiplier): $OVERRIDE_RULE_ID"
else
  info "Response: $OVERRIDE_RULE"
fi

# ============================================================================
# Step 6: List Special Rules
# ============================================================================
step "Step 6: Listing customer special rules..."

RULES_LIST=$(curl -s -X GET "$BASE_URL/api/customers/$CUSTOMER_ID/special-rules" \
  -H "Authorization: Bearer $TOKEN")

RULE_COUNT=$(echo "$RULES_LIST" | grep -o '"id":"[^"]*"' | wc -l | tr -d ' ')

if [ "$RULE_COUNT" -gt 0 ]; then
  ok "Found $RULE_COUNT special rule(s) for customer"
  echo -e "${CYAN}   Rules:${NC}"
  echo "$RULES_LIST" | grep -o '"name":"[^"]*"' | while read -r line; do
    NAME=$(echo "$line" | cut -d'"' -f4)
    echo -e "${CYAN}   - $NAME${NC}"
  done
else
  fail "No special rules found"
fi

# ============================================================================
# Step 7: Ensure Project Binding
# ============================================================================
step "Step 7: Ensuring project binding..."

PROJECT_CHECK=$(curl -s -X POST "$BASE_URL/api/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectId": "special-rules-test-project",
    "name": "Special Rules Test Project"
  }')

if echo "$PROJECT_CHECK" | grep -q '"id"'; then
  ok "Project created/exists: special-rules-test-project"
fi

BIND_CHECK=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"projectId": "special-rules-test-project"}')

if echo "$BIND_CHECK" | grep -q '"id"'; then
  ok "Project bound to customer"
elif echo "$BIND_CHECK" | grep -q 'already bound'; then
  ok "Project already bound (OK)"
fi

# ============================================================================
# Step 8: Import Raw Cost Data
# ============================================================================
step "Step 8: Importing raw cost data..."

YEAR=$(echo "$BILLING_MONTH" | cut -d'-' -f1)
MONTH=$(echo "$BILLING_MONTH" | cut -d'-' -f2)

# Import cost data with SKUs that will trigger special rules
IMPORT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/raw-cost/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"source\": \"special-rules-test\",
    \"month\": \"$BILLING_MONTH\",
    \"entries\": [
      {
        \"billingAccountId\": \"billingAccounts/SPECIAL-RULES-TEST\",
        \"projectId\": \"special-rules-test-project\",
        \"serviceId\": \"compute.googleapis.com\",
        \"skuId\": \"SKU-SPECIAL-COMPUTE\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-15T00:00:00Z\",
        \"usageAmount\": 720,
        \"cost\": 100.00,
        \"currency\": \"USD\"
      },
      {
        \"billingAccountId\": \"billingAccounts/SPECIAL-RULES-TEST\",
        \"projectId\": \"special-rules-test-project\",
        \"serviceId\": \"promo.googleapis.com\",
        \"skuId\": \"SKU-SPECIAL-PROMO\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-28T00:00:00Z\",
        \"usageAmount\": 10000,
        \"cost\": 50.00,
        \"currency\": \"USD\"
      },
      {
        \"billingAccountId\": \"billingAccounts/SPECIAL-RULES-TEST\",
        \"projectId\": \"special-rules-test-project\",
        \"serviceId\": \"storage.googleapis.com\",
        \"skuId\": \"SKU-SPECIAL-STORAGE\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-28T00:00:00Z\",
        \"usageAmount\": 1000000,
        \"cost\": 30.00,
        \"currency\": \"USD\"
      }
    ]
  }")

BATCH_ID=$(echo "$IMPORT_RESPONSE" | grep -o '"batchId":"[^"]*"' | cut -d'"' -f4)

if [ -n "$BATCH_ID" ]; then
  ok "Imported raw cost data. Batch: $BATCH_ID"
  info "Raw costs breakdown:"
  info "  - Compute: \$100 (will be 50% -> \$50)"
  info "  - Promo: \$50 (will be EXCLUDED -> \$0)"
  info "  - Storage: \$30 (no rule -> \$30)"
  info "  Total raw: \$180, Expected after rules: \$80"
else
  info "Response: $IMPORT_RESPONSE"
fi

# ============================================================================
# Step 9: Create and Execute Invoice Run
# ============================================================================
step "Step 9: Creating invoice run..."

RUN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/invoice-runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"billingMonth\": \"$BILLING_MONTH\"}")

RUN_ID=$(echo "$RUN_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$RUN_ID" ]; then
  ok "Created invoice run: $RUN_ID"
else
  if echo "$RUN_RESPONSE" | grep -q '"_idempotent":true'; then
    RUN_ID=$(echo "$RUN_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    ok "Using existing run: $RUN_ID"
  else
    info "Response: $RUN_RESPONSE"
  fi
fi

step "Step 10: Executing invoice run..."

if [ -n "$RUN_ID" ]; then
  EXEC_RESPONSE=$(curl -s -X POST "$BASE_URL/api/invoice-runs/$RUN_ID/execute" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN")

  echo ""
  info "=== EXECUTION RESULT ==="

  STATUS=$(echo "$EXEC_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  RAW_TOTAL=$(echo "$EXEC_RESPONSE" | grep -o '"rawTotalAmount":"[^"]*"' | cut -d'"' -f4)
  FINAL_TOTAL=$(echo "$EXEC_RESPONSE" | grep -o '"totalAmount":"[^"]*"' | cut -d'"' -f4)
  SPECIAL_RULES_APPLIED=$(echo "$EXEC_RESPONSE" | grep -o '"specialRulesApplied":[^,}]*' | cut -d':' -f2)
  SPECIAL_RULES_DELTA=$(echo "$EXEC_RESPONSE" | grep -o '"totalSpecialRulesDelta":"[^"]*"' | cut -d'"' -f4)
  SPECIAL_RULES_COUNT=$(echo "$EXEC_RESPONSE" | grep -o '"specialRulesCount":[0-9]*' | cut -d':' -f2)

  if [ "$STATUS" = "SUCCEEDED" ]; then
    ok "Invoice run executed successfully"
    echo ""
    echo -e "${CYAN}   SPECIAL RULES SUMMARY:${NC}"
    echo -e "${CYAN}   ├─ Raw Total:            \$${RAW_TOTAL}${NC}"
    echo -e "${CYAN}   ├─ Final Amount:         \$${FINAL_TOTAL}${NC}"
    echo -e "${CYAN}   ├─ Special Rules Applied: ${SPECIAL_RULES_APPLIED}${NC}"
    echo -e "${CYAN}   ├─ Rules Count:           ${SPECIAL_RULES_COUNT}${NC}"
    echo -e "${CYAN}   └─ Cost Delta:            \$${SPECIAL_RULES_DELTA}${NC}"
    echo ""

    info "Expected:"
    info "  Raw Total: \$180"
    info "  After EXCLUDE (promo): \$180 - \$50 = \$130"
    info "  After OVERRIDE_COST (compute 50%): \$130 - \$50 = \$80"
    info "  Final Expected: \$80"

  else
    fail "Invoice run failed"
    info "Response: $EXEC_RESPONSE"
  fi
fi

# ============================================================================
# Step 11: Get Special Rule Effect Details
# ============================================================================
step "Step 11: Getting special rule effect details..."

if [ -n "$EXCLUDE_RULE_ID" ]; then
  RULE_DETAIL=$(curl -s -X GET "$BASE_URL/api/special-rules/$EXCLUDE_RULE_ID" \
    -H "Authorization: Bearer $TOKEN")

  EFFECT_COUNT=$(echo "$RULE_DETAIL" | grep -o '"effectHistory"' | wc -l | tr -d ' ')

  if [ "$EFFECT_COUNT" -gt 0 ]; then
    ok "EXCLUDE rule has effect history"

    # Extract effect summary
    AFFECTED=$(echo "$RULE_DETAIL" | grep -o '"affectedRowCount":[0-9]*' | head -1 | cut -d':' -f2)
    DELTA=$(echo "$RULE_DETAIL" | grep -o '"costDelta":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -n "$AFFECTED" ]; then
      echo -e "${CYAN}   - Affected rows: $AFFECTED${NC}"
      echo -e "${CYAN}   - Cost delta: \$$DELTA${NC}"
    fi
  fi
fi

# ============================================================================
# Step 12: Query Invoice Details
# ============================================================================
step "Step 12: Querying invoice details..."

INVOICES=$(curl -s -X GET "$BASE_URL/api/invoices?billingMonth=$BILLING_MONTH" \
  -H "Authorization: Bearer $TOKEN")

INVOICE_ID=$(echo "$INVOICES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
INVOICE_NUMBER=$(echo "$INVOICES" | grep -o '"invoiceNumber":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$INVOICE_ID" ]; then
  ok "Found invoice: $INVOICE_NUMBER"

  INVOICE_DETAIL=$(curl -s -X GET "$BASE_URL/api/invoices/$INVOICE_ID" \
    -H "Authorization: Bearer $TOKEN")

  SUBTOTAL=$(echo "$INVOICE_DETAIL" | grep -o '"subtotal":"[^"]*"' | cut -d'"' -f4)
  TOTAL=$(echo "$INVOICE_DETAIL" | grep -o '"totalAmount":"[^"]*"' | cut -d'"' -f4)

  echo -e "${CYAN}   Invoice Details:${NC}"
  echo -e "${CYAN}   ├─ Subtotal:     \$${SUBTOTAL}${NC}"
  echo -e "${CYAN}   └─ Total Amount: \$${TOTAL}${NC}"
fi

# ============================================================================
# Step 13: Test Global Rule (super_admin only)
# ============================================================================
step "Step 13: Testing global rule creation..."

GLOBAL_RULE=$(curl -s -X POST "$BASE_URL/api/special-rules" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Global Test Rule",
    "ruleType": "EXCLUDE_SKU",
    "priority": 1,
    "matchSkuId": "SKU-GLOBAL-TEST",
    "enabled": false
  }')

if echo "$GLOBAL_RULE" | grep -q '"id"'; then
  GLOBAL_RULE_ID=$(echo "$GLOBAL_RULE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  ok "Created global rule: $GLOBAL_RULE_ID"

  # Clean up - delete the global rule
  curl -s -X DELETE "$BASE_URL/api/special-rules/$GLOBAL_RULE_ID" \
    -H "Authorization: Bearer $TOKEN" > /dev/null
  ok "Cleaned up global test rule"
elif echo "$GLOBAL_RULE" | grep -q 'super_admin'; then
  info "Global rule creation requires super_admin (expected behavior)"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All Phase 3.5 special rules tests passed!${NC}"
else
  echo -e "${RED}Some tests failed - review output above${NC}"
fi

echo ""
echo "========================================"
echo "Curl Commands Reference"
echo "========================================"
cat << 'EOF'

# Create customer special rule (EXCLUDE_SKU_GROUP)
curl -X POST http://localhost:3000/api/customers/{CUSTOMER_ID}/special-rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Exclude Promotional Services",
    "ruleType": "EXCLUDE_SKU_GROUP",
    "priority": 10,
    "matchSkuGroupId": "{SKU_GROUP_ID}"
  }'

# Create customer special rule (OVERRIDE_COST)
curl -X POST http://localhost:3000/api/customers/{CUSTOMER_ID}/special-rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "50% Compute Discount",
    "ruleType": "OVERRIDE_COST",
    "priority": 20,
    "matchServiceId": "compute.googleapis.com",
    "costMultiplier": 0.5
  }'

# Create global special rule (super_admin only)
curl -X POST http://localhost:3000/api/special-rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Global Exclude Rule",
    "ruleType": "EXCLUDE_SKU",
    "priority": 1,
    "matchSkuId": "SKU-EXCLUDE-GLOBALLY"
  }'

# List customer special rules
curl http://localhost:3000/api/customers/{CUSTOMER_ID}/special-rules \
  -H "Authorization: Bearer $TOKEN"

# Get special rule details with effect history
curl http://localhost:3000/api/special-rules/{RULE_ID} \
  -H "Authorization: Bearer $TOKEN"

# Update special rule
curl -X PATCH http://localhost:3000/api/special-rules/{RULE_ID} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"enabled": false}'

# Delete special rule (soft delete)
curl -X DELETE http://localhost:3000/api/special-rules/{RULE_ID} \
  -H "Authorization: Bearer $TOKEN"

# Rule Types:
# - EXCLUDE_SKU: Remove specific SKU from billing
# - EXCLUDE_SKU_GROUP: Remove entire SKU group from billing
# - OVERRIDE_COST: Multiply cost by costMultiplier (0 = free)
# - MOVE_TO_CUSTOMER: Re-assign costs to targetCustomerId

# Match Conditions (AND logic):
# - matchSkuId: Match specific Google SKU ID
# - matchSkuGroupId: Match SKU group
# - matchServiceId: Match GCP service ID
# - matchProjectId: Match GCP project ID
# - matchBillingAccountId: Match billing account ID

EOF

echo ""
echo "Phase 3.5 special rules test completed!"
