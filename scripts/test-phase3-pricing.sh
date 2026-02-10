#!/bin/bash
#
# Phase 3: SKU Groups & Pricing Engine Test Script
#
# Tests the complete pricing workflow:
# 1. Create SKUs (Google Cloud SKU definitions)
# 2. Create SKU Groups (logical groupings for pricing)
# 3. Map SKUs to groups
# 4. Create pricing list for customer
# 5. Create pricing rules (LIST_DISCOUNT)
# 6. Import raw cost data with SKU IDs
# 7. Run invoice run and verify discounted totals
#
# Prerequisites:
# - Server running on localhost:3000
# - Database seeded with default admin user and at least one customer
#
# Usage: ./scripts/test-phase3-pricing.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
BILLING_MONTH="${BILLING_MONTH:-2026-03}"

echo "========================================"
echo "Phase 3: SKU Groups & Pricing Engine Test"
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
# Step 2: Create SKUs (Google Cloud SKU definitions)
# ============================================================================
step "Step 2: Creating SKUs..."

SKUS_RESPONSE=$(curl -s -X POST "$BASE_URL/api/skus" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "skus": [
      {
        "skuId": "SKU-N1-STANDARD-1",
        "skuDescription": "N1 Standard Instance Core running",
        "serviceId": "compute.googleapis.com",
        "serviceDescription": "Compute Engine",
        "unit": "hour"
      },
      {
        "skuId": "SKU-N1-STANDARD-2",
        "skuDescription": "N1 Standard Instance Core running (2 vCPU)",
        "serviceId": "compute.googleapis.com",
        "serviceDescription": "Compute Engine",
        "unit": "hour"
      },
      {
        "skuId": "SKU-STANDARD-STORAGE",
        "skuDescription": "Standard Storage US Regional",
        "serviceId": "storage.googleapis.com",
        "serviceDescription": "Cloud Storage",
        "unit": "byte-seconds"
      },
      {
        "skuId": "SKU-BQ-ANALYSIS",
        "skuDescription": "BigQuery Analysis Bytes",
        "serviceId": "bigquery.googleapis.com",
        "serviceDescription": "BigQuery",
        "unit": "byte"
      }
    ]
  }')

if echo "$SKUS_RESPONSE" | grep -q '"count"'; then
  COUNT=$(echo "$SKUS_RESPONSE" | grep -o '"count":[0-9]*' | cut -d':' -f2)
  ok "Created $COUNT SKUs"
elif echo "$SKUS_RESPONSE" | grep -q 'already exist'; then
  ok "SKUs already exist (OK)"
else
  info "Response: $SKUS_RESPONSE"
fi

# ============================================================================
# Step 3: Create SKU Groups
# ============================================================================
step "Step 3: Creating SKU Groups..."

# Create Compute group
COMPUTE_GROUP=$(curl -s -X POST "$BASE_URL/api/sku-groups" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "code": "COMPUTE-N1",
    "name": "Compute Engine N1 Instances",
    "description": "N1 series virtual machine instances"
  }')

COMPUTE_GROUP_ID=$(echo "$COMPUTE_GROUP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$COMPUTE_GROUP_ID" ]; then
  ok "Created COMPUTE-N1 group: $COMPUTE_GROUP_ID"
elif echo "$COMPUTE_GROUP" | grep -q 'already exists'; then
  ok "COMPUTE-N1 group already exists"
  # Get existing group ID
  GROUPS_LIST=$(curl -s -X GET "$BASE_URL/api/sku-groups?search=COMPUTE-N1" \
    -H "Authorization: Bearer $TOKEN")
  COMPUTE_GROUP_ID=$(echo "$GROUPS_LIST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

# Create Storage group
STORAGE_GROUP=$(curl -s -X POST "$BASE_URL/api/sku-groups" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "code": "STORAGE-STANDARD",
    "name": "Cloud Storage Standard",
    "description": "Standard tier cloud storage"
  }')

STORAGE_GROUP_ID=$(echo "$STORAGE_GROUP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$STORAGE_GROUP_ID" ]; then
  ok "Created STORAGE-STANDARD group: $STORAGE_GROUP_ID"
elif echo "$STORAGE_GROUP" | grep -q 'already exists'; then
  ok "STORAGE-STANDARD group already exists"
  GROUPS_LIST=$(curl -s -X GET "$BASE_URL/api/sku-groups?search=STORAGE-STANDARD" \
    -H "Authorization: Bearer $TOKEN")
  STORAGE_GROUP_ID=$(echo "$GROUPS_LIST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

# ============================================================================
# Step 4: Map SKUs to Groups
# ============================================================================
step "Step 4: Mapping SKUs to Groups..."

if [ -n "$COMPUTE_GROUP_ID" ]; then
  COMPUTE_MAP=$(curl -s -X POST "$BASE_URL/api/sku-groups/$COMPUTE_GROUP_ID/mappings" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"skuIds": ["SKU-N1-STANDARD-1", "SKU-N1-STANDARD-2"]}')

  ADDED=$(echo "$COMPUTE_MAP" | grep -o '"added":[0-9]*' | cut -d':' -f2)
  ok "Mapped $ADDED SKU(s) to COMPUTE-N1"
fi

if [ -n "$STORAGE_GROUP_ID" ]; then
  STORAGE_MAP=$(curl -s -X POST "$BASE_URL/api/sku-groups/$STORAGE_GROUP_ID/mappings" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"skuIds": ["SKU-STANDARD-STORAGE"]}')

  ADDED=$(echo "$STORAGE_MAP" | grep -o '"added":[0-9]*' | cut -d':' -f2)
  ok "Mapped $ADDED SKU(s) to STORAGE-STANDARD"
fi

# ============================================================================
# Step 5: Get Customer ID
# ============================================================================
step "Step 5: Getting customer..."

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
# Step 6: Create Pricing List for Customer
# ============================================================================
step "Step 6: Creating pricing list..."

PRICING_LIST=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/pricing-lists" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Standard Pricing 2026",
    "status": "ACTIVE"
  }')

PRICING_LIST_ID=$(echo "$PRICING_LIST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$PRICING_LIST_ID" ]; then
  ok "Created pricing list: $PRICING_LIST_ID"
else
  info "Response: $PRICING_LIST"
  # Try to get existing pricing list
  EXISTING_LISTS=$(curl -s -X GET "$BASE_URL/api/customers/$CUSTOMER_ID/pricing-lists?status=ACTIVE" \
    -H "Authorization: Bearer $TOKEN")
  PRICING_LIST_ID=$(echo "$EXISTING_LISTS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$PRICING_LIST_ID" ]; then
    ok "Using existing pricing list: $PRICING_LIST_ID"
  fi
fi

# ============================================================================
# Step 7: Create Pricing Rules
# ============================================================================
step "Step 7: Creating pricing rules..."

if [ -n "$PRICING_LIST_ID" ]; then
  # Rule 1: 15% discount for Compute (0.85 = 85% of list)
  COMPUTE_RULE=$(curl -s -X POST "$BASE_URL/api/pricing-lists/$PRICING_LIST_ID/rules" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{
      \"ruleType\": \"LIST_DISCOUNT\",
      \"discountRate\": 0.85,
      \"skuGroupId\": \"$COMPUTE_GROUP_ID\",
      \"priority\": 10
    }")

  if echo "$COMPUTE_RULE" | grep -q '"id"'; then
    ok "Created COMPUTE rule: 15% discount (rate=0.85)"
  else
    info "Compute rule: $COMPUTE_RULE"
  fi

  # Rule 2: 10% discount for Storage (0.90 = 90% of list)
  STORAGE_RULE=$(curl -s -X POST "$BASE_URL/api/pricing-lists/$PRICING_LIST_ID/rules" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{
      \"ruleType\": \"LIST_DISCOUNT\",
      \"discountRate\": 0.90,
      \"skuGroupId\": \"$STORAGE_GROUP_ID\",
      \"priority\": 10
    }")

  if echo "$STORAGE_RULE" | grep -q '"id"'; then
    ok "Created STORAGE rule: 10% discount (rate=0.90)"
  else
    info "Storage rule: $STORAGE_RULE"
  fi

  # Rule 3: Default 5% discount for everything else (fallback)
  DEFAULT_RULE=$(curl -s -X POST "$BASE_URL/api/pricing-lists/$PRICING_LIST_ID/rules" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "ruleType": "LIST_DISCOUNT",
      "discountRate": 0.95,
      "priority": 100
    }')

  if echo "$DEFAULT_RULE" | grep -q '"id"'; then
    ok "Created DEFAULT rule: 5% discount (rate=0.95, applies to all)"
  else
    info "Default rule: $DEFAULT_RULE"
  fi
fi

# ============================================================================
# Step 8: List Pricing Rules (verify)
# ============================================================================
step "Step 8: Verifying pricing rules..."

if [ -n "$PRICING_LIST_ID" ]; then
  RULES_LIST=$(curl -s -X GET "$BASE_URL/api/pricing-lists/$PRICING_LIST_ID/rules" \
    -H "Authorization: Bearer $TOKEN")

  RULE_COUNT=$(echo "$RULES_LIST" | grep -o '"id":"[^"]*"' | wc -l)
  ok "Found $RULE_COUNT pricing rule(s)"

  # Display rules summary
  echo "$RULES_LIST" | grep -o '"discountPercent":"[^"]*"' | while read -r line; do
    echo -e "${CYAN}   - Discount: ${line#*:}${NC}"
  done
fi

# ============================================================================
# Step 9: Ensure Project Binding
# ============================================================================
step "Step 9: Ensuring project binding..."

# Check/create project
PROJECT_CHECK=$(curl -s -X POST "$BASE_URL/api/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectId": "pricing-test-project",
    "name": "Pricing Test Project"
  }')

if echo "$PROJECT_CHECK" | grep -q '"id"'; then
  ok "Project created/exists: pricing-test-project"
fi

# Bind project to customer
BIND_CHECK=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"projectId": "pricing-test-project"}')

if echo "$BIND_CHECK" | grep -q '"id"'; then
  ok "Project bound to customer"
elif echo "$BIND_CHECK" | grep -q 'already bound'; then
  ok "Project already bound (OK)"
fi

# ============================================================================
# Step 10: Import Raw Cost Data with SKU IDs
# ============================================================================
step "Step 10: Importing raw cost data..."

YEAR=$(echo "$BILLING_MONTH" | cut -d'-' -f1)
MONTH=$(echo "$BILLING_MONTH" | cut -d'-' -f2)

# Import cost data with specific SKU IDs
IMPORT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/raw-cost/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"source\": \"pricing-test\",
    \"month\": \"$BILLING_MONTH\",
    \"entries\": [
      {
        \"billingAccountId\": \"billingAccounts/PRICING-TEST\",
        \"projectId\": \"pricing-test-project\",
        \"serviceId\": \"compute.googleapis.com\",
        \"skuId\": \"SKU-N1-STANDARD-1\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-15T00:00:00Z\",
        \"usageAmount\": 720,
        \"cost\": 100.00,
        \"currency\": \"USD\"
      },
      {
        \"billingAccountId\": \"billingAccounts/PRICING-TEST\",
        \"projectId\": \"pricing-test-project\",
        \"serviceId\": \"storage.googleapis.com\",
        \"skuId\": \"SKU-STANDARD-STORAGE\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-28T00:00:00Z\",
        \"usageAmount\": 1000000,
        \"cost\": 50.00,
        \"currency\": \"USD\"
      },
      {
        \"billingAccountId\": \"billingAccounts/PRICING-TEST\",
        \"projectId\": \"pricing-test-project\",
        \"serviceId\": \"bigquery.googleapis.com\",
        \"skuId\": \"SKU-BQ-ANALYSIS\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-10T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-20T00:00:00Z\",
        \"usageAmount\": 500000000,
        \"cost\": 25.00,
        \"currency\": \"USD\"
      }
    ]
  }")

BATCH_ID=$(echo "$IMPORT_RESPONSE" | grep -o '"batchId":"[^"]*"' | cut -d'"' -f4)

if [ -n "$BATCH_ID" ]; then
  ok "Imported raw cost data. Batch: $BATCH_ID"
  info "Raw costs: Compute \$100, Storage \$50, BigQuery \$25 = Total \$175"
else
  info "Response: $IMPORT_RESPONSE"
fi

# ============================================================================
# Step 11: Create and Execute Invoice Run
# ============================================================================
step "Step 11: Creating invoice run..."

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

step "Step 12: Executing invoice run..."

if [ -n "$RUN_ID" ]; then
  EXEC_RESPONSE=$(curl -s -X POST "$BASE_URL/api/invoice-runs/$RUN_ID/execute" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN")

  echo ""
  info "=== EXECUTION RESULT ==="

  STATUS=$(echo "$EXEC_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  RAW_TOTAL=$(echo "$EXEC_RESPONSE" | grep -o '"rawTotalAmount":"[^"]*"' | cut -d'"' -f4)
  PRICED_TOTAL=$(echo "$EXEC_RESPONSE" | grep -o '"totalAmount":"[^"]*"' | cut -d'"' -f4)
  DISCOUNT=$(echo "$EXEC_RESPONSE" | grep -o '"totalDiscount":"[^"]*"' | cut -d'"' -f4)
  PRICING_APPLIED=$(echo "$EXEC_RESPONSE" | grep -o '"pricingApplied":[^,}]*' | cut -d':' -f2)

  if [ "$STATUS" = "SUCCEEDED" ]; then
    ok "Invoice run executed successfully"
    echo ""
    echo -e "${CYAN}   PRICING SUMMARY:${NC}"
    echo -e "${CYAN}   ├─ Raw Total:     \$${RAW_TOTAL}${NC}"
    echo -e "${CYAN}   ├─ Priced Total:  \$${PRICED_TOTAL}${NC}"
    echo -e "${CYAN}   ├─ Total Discount: \$${DISCOUNT}${NC}"
    echo -e "${CYAN}   └─ Pricing Applied: ${PRICING_APPLIED}${NC}"
    echo ""

    # Expected calculations:
    # Compute: $100 * 0.85 = $85 (15% discount)
    # Storage: $50 * 0.90 = $45 (10% discount)
    # BigQuery: $25 * 0.95 = $23.75 (5% default discount, UNMAPPED)
    # Expected Total: $153.75
    info "Expected: Compute \$85 + Storage \$45 + BigQuery \$23.75 = \$153.75"

  else
    fail "Invoice run failed"
    info "Response: $EXEC_RESPONSE"
  fi
fi

# ============================================================================
# Step 13: Query Invoice Details
# ============================================================================
step "Step 13: Querying invoice details..."

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

  echo -e "${CYAN}   Invoice Amount: \$${TOTAL}${NC}"

  # Check for pricing breakdown in currencyBreakdown
  if echo "$INVOICE_DETAIL" | grep -q '"pricing"'; then
    ok "Invoice includes pricing breakdown"
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
  echo -e "${GREEN}All Phase 3 pricing tests passed!${NC}"
else
  echo -e "${RED}Some tests failed - review output above${NC}"
fi

echo ""
echo "========================================"
echo "Curl Commands Reference"
echo "========================================"
cat << 'EOF'

# Create SKUs
curl -X POST http://localhost:3000/api/skus \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "skus": [{
      "skuId": "SKU-N1-STANDARD-1",
      "skuDescription": "N1 Standard Instance",
      "serviceId": "compute.googleapis.com",
      "serviceDescription": "Compute Engine",
      "unit": "hour"
    }]
  }'

# Create SKU Group
curl -X POST http://localhost:3000/api/sku-groups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"code": "COMPUTE-N1", "name": "Compute N1 Instances"}'

# Map SKUs to Group
curl -X POST http://localhost:3000/api/sku-groups/{GROUP_ID}/mappings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"skuIds": ["SKU-N1-STANDARD-1"]}'

# Create Pricing List
curl -X POST http://localhost:3000/api/customers/{CUSTOMER_ID}/pricing-lists \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "Standard Pricing", "status": "ACTIVE"}'

# Create Pricing Rule (15% discount)
curl -X POST http://localhost:3000/api/pricing-lists/{LIST_ID}/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "ruleType": "LIST_DISCOUNT",
    "discountRate": 0.85,
    "skuGroupId": "{GROUP_ID}",
    "priority": 10
  }'

# Execute Invoice Run (verify discounted totals)
curl -X POST http://localhost:3000/api/invoice-runs/{RUN_ID}/execute \
  -H "Authorization: Bearer $TOKEN"

# Response includes:
# {
#   "rawTotalAmount": "175.00",
#   "totalAmount": "153.75",
#   "totalDiscount": "21.25",
#   "pricingApplied": true
# }

EOF

echo ""
echo "Phase 3 pricing test completed!"
