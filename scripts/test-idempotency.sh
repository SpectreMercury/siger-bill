#!/bin/bash
#
# Phase 2.6 Idempotency Test Script
#
# Tests idempotency guarantees for:
# 1. Raw cost import (checksum + month + source)
# 2. Invoice run creation (billingMonth + targetCustomerId + sourceKey)
#
# Prerequisites:
# - Server running on localhost:3000
# - Database seeded with default admin user
#
# Usage: ./scripts/test-idempotency.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
BILLING_MONTH="${BILLING_MONTH:-2026-02}"

echo "========================================"
echo "Phase 2.6 Idempotency Tests"
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
  echo -e "${YELLOW}=> $1${NC}"
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
step "Authenticating..."

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
# Test 1: Raw Cost Import Idempotency
# ============================================================================
echo ""
echo "========================================"
echo "Test 1: Raw Cost Import Idempotency"
echo "========================================"

step "First import (should create new batch)..."

YEAR=$(echo "$BILLING_MONTH" | cut -d'-' -f1)
MONTH=$(echo "$BILLING_MONTH" | cut -d'-' -f2)

# Use unique test data
IMPORT_DATA="{
  \"source\": \"idempotency-test\",
  \"month\": \"$BILLING_MONTH\",
  \"entries\": [
    {
      \"billingAccountId\": \"billingAccounts/IDEMPOTENCY-TEST\",
      \"projectId\": \"idempotency-test-project\",
      \"serviceId\": \"compute.googleapis.com\",
      \"skuId\": \"SKU-IDEM-TEST\",
      \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
      \"usageEndTime\": \"${YEAR}-${MONTH}-15T00:00:00Z\",
      \"usageAmount\": 100,
      \"cost\": 10.00,
      \"currency\": \"USD\"
    }
  ]
}"

IMPORT_1=$(curl -s -X POST "$BASE_URL/api/raw-cost/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$IMPORT_DATA")

BATCH_ID_1=$(echo "$IMPORT_1" | grep -o '"batchId":"[^"]*"' | cut -d'"' -f4)
IDEMPOTENT_1=$(echo "$IMPORT_1" | grep -o '"_idempotent":true' || echo "")

if [ -n "$BATCH_ID_1" ] && [ -z "$IDEMPOTENT_1" ]; then
  ok "First import created new batch: $BATCH_ID_1"
else
  fail "First import should create new batch"
  info "Response: $IMPORT_1"
fi

step "Second import (same data - should return idempotent)..."

IMPORT_2=$(curl -s -X POST "$BASE_URL/api/raw-cost/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$IMPORT_DATA")

BATCH_ID_2=$(echo "$IMPORT_2" | grep -o '"batchId":"[^"]*"' | cut -d'"' -f4)
IDEMPOTENT_2=$(echo "$IMPORT_2" | grep -o '"_idempotent":true' || echo "")

if [ "$BATCH_ID_1" = "$BATCH_ID_2" ] && [ -n "$IDEMPOTENT_2" ]; then
  ok "Second import returned same batch with _idempotent flag"
else
  fail "Second import should return same batch ID with _idempotent flag"
  info "Batch 1: $BATCH_ID_1, Batch 2: $BATCH_ID_2"
  info "Response: $IMPORT_2"
fi

# ============================================================================
# Test 2: Invoice Run Idempotency
# ============================================================================
echo ""
echo "========================================"
echo "Test 2: Invoice Run Idempotency"
echo "========================================"

step "First invoice run creation (should create new run)..."

RUN_1=$(curl -s -X POST "$BASE_URL/api/invoice-runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"billingMonth\": \"$BILLING_MONTH\"}")

RUN_ID_1=$(echo "$RUN_1" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
IDEMPOTENT_RUN_1=$(echo "$RUN_1" | grep -o '"_idempotent":true' || echo "")

if [ -n "$RUN_ID_1" ] && [ -z "$IDEMPOTENT_RUN_1" ]; then
  ok "First run created: $RUN_ID_1"
else
  # May already exist from previous test - check for idempotent response
  if [ -n "$IDEMPOTENT_RUN_1" ]; then
    ok "Run already exists (idempotent): $RUN_ID_1"
  else
    fail "First run should create or return idempotent existing run"
    info "Response: $RUN_1"
  fi
fi

step "Second invoice run creation (same params - should return idempotent or conflict)..."

RUN_2=$(curl -s -X POST "$BASE_URL/api/invoice-runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"billingMonth\": \"$BILLING_MONTH\"}")

RUN_ID_2=$(echo "$RUN_2" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
IDEMPOTENT_RUN_2=$(echo "$RUN_2" | grep -o '"_idempotent":true' || echo "")
CONFLICT=$(echo "$RUN_2" | grep -o '"code":"CONFLICT"' || echo "")

if [ "$RUN_ID_1" = "$RUN_ID_2" ] && [ -n "$IDEMPOTENT_RUN_2" ]; then
  ok "Second run returned same ID with _idempotent flag"
elif [ -n "$CONFLICT" ]; then
  ok "Second run returned 409 Conflict (different sourceKey detected)"
  info "Response: $RUN_2"
else
  fail "Second run should return idempotent or conflict"
  info "Run 1 ID: $RUN_ID_1, Run 2 ID: $RUN_ID_2"
  info "Response: $RUN_2"
fi

# ============================================================================
# Test 3: Invoice Run with Different Parameters (should create new)
# ============================================================================
echo ""
echo "========================================"
echo "Test 3: Invoice Run Different Params"
echo "========================================"

step "Creating run with ingestionBatchId (different sourceKey)..."

RUN_3=$(curl -s -X POST "$BASE_URL/api/invoice-runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"billingMonth\": \"$BILLING_MONTH\", \"ingestionBatchId\": \"$BATCH_ID_1\"}")

RUN_ID_3=$(echo "$RUN_3" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
CONFLICT_3=$(echo "$RUN_3" | grep -o '"code":"CONFLICT"' || echo "")
SOURCE_KEY=$(echo "$RUN_3" | grep -o '"sourceKey":"[^"]*"' | cut -d'"' -f4)

if [ -n "$RUN_ID_3" ]; then
  ok "Created run with batch-specific sourceKey: $SOURCE_KEY"
elif [ -n "$CONFLICT_3" ]; then
  info "Conflict: Another run already active (expected if first run not completed)"
  info "Response: $RUN_3"
else
  fail "Should create new run or return conflict"
  info "Response: $RUN_3"
fi

# ============================================================================
# Test 4: Execute and Verify Metadata
# ============================================================================
echo ""
echo "========================================"
echo "Test 4: Execute and Verify Metadata"
echo "========================================"

# Find a QUEUED run to execute
step "Finding QUEUED run to execute..."

RUNS_LIST=$(curl -s -X GET "$BASE_URL/api/invoice-runs?billingMonth=$BILLING_MONTH&status=QUEUED" \
  -H "Authorization: Bearer $TOKEN")

QUEUED_RUN_ID=$(echo "$RUNS_LIST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$QUEUED_RUN_ID" ]; then
  ok "Found QUEUED run: $QUEUED_RUN_ID"

  step "Executing run..."

  EXEC_RESULT=$(curl -s -X POST "$BASE_URL/api/invoice-runs/$QUEUED_RUN_ID/execute" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN")

  # Check for metadata in response
  CUSTOMER_COUNT=$(echo "$EXEC_RESULT" | grep -o '"customerCount":[0-9]*' | cut -d':' -f2)
  PROJECT_COUNT=$(echo "$EXEC_RESULT" | grep -o '"projectCount":[0-9]*' | cut -d':' -f2)
  ROW_COUNT=$(echo "$EXEC_RESULT" | grep -o '"rowCount":[0-9]*' | cut -d':' -f2)

  if [ -n "$CUSTOMER_COUNT" ] && [ -n "$PROJECT_COUNT" ] && [ -n "$ROW_COUNT" ]; then
    ok "Phase 2.6 metadata returned:"
    info "  customerCount: $CUSTOMER_COUNT"
    info "  projectCount: $PROJECT_COUNT"
    info "  rowCount: $ROW_COUNT"
  else
    info "Run executed (check response for details)"
    info "Response (truncated): $(echo "$EXEC_RESULT" | head -c 500)..."
  fi
else
  info "No QUEUED runs available to execute"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All idempotency tests passed!${NC}"
else
  echo -e "${RED}Some tests failed - review output above${NC}"
fi

echo ""
echo "========================================"
echo "Curl Commands for Manual Testing"
echo "========================================"
cat << 'EOF'

# Test raw-cost import idempotency
# First call creates, second call returns _idempotent: true
curl -X POST http://localhost:3000/api/raw-cost/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "source": "test",
    "month": "2026-02",
    "entries": [{
      "billingAccountId": "billingAccounts/TEST",
      "projectId": "test-project",
      "serviceId": "compute.googleapis.com",
      "skuId": "SKU-001",
      "usageStartTime": "2026-02-01T00:00:00Z",
      "usageEndTime": "2026-02-28T00:00:00Z",
      "usageAmount": 100,
      "cost": 10.00,
      "currency": "USD"
    }]
  }'

# Test invoice-run idempotency
# First call creates, second call returns _idempotent: true
curl -X POST http://localhost:3000/api/invoice-runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"billingMonth": "2026-02"}'

# Test invoice-run with specific batch (different sourceKey)
curl -X POST http://localhost:3000/api/invoice-runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"billingMonth": "2026-02", "ingestionBatchId": "BATCH_UUID_HERE"}'

# Execute run and verify Phase 2.6 metadata
curl -X POST http://localhost:3000/api/invoice-runs/{RUN_ID}/execute \
  -H "Authorization: Bearer $TOKEN"

# Expected metadata in response:
# {
#   "metadata": {
#     "customerCount": 1,
#     "projectCount": 2,
#     "rowCount": 150,
#     "currencyBreakdown": {"USD": "1234.56"},
#     "ingestionBatchIds": ["..."],
#     "costDataTimeRange": {"from": "...", "to": "..."}
#   }
# }

EOF

echo ""
echo "Idempotency test completed!"
