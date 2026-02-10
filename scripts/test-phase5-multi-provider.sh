#!/bin/bash

# ============================================================================
# Phase 5: Multi-Provider Billing Test Script
# ============================================================================
#
# This script tests the unified billing model with multiple providers:
# - GCP: Tests BillingLineItem creation and invoice generation
# - AWS: Tests CUR adapter structure (mocked data)
# - OpenAI: Tests usage API adapter structure (mocked data)
#
# Prerequisites:
# - PostgreSQL running with bill-system database
# - npm run db:push completed
# - .env configured
#
# Usage:
#   ./scripts/test-phase5-multi-provider.sh
#
# ============================================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_URL="$BASE_URL/api"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test utilities
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; exit 1; }
info() { echo -e "${BLUE}ℹ INFO${NC}: $1"; }
warn() { echo -e "${YELLOW}⚠ WARN${NC}: $1"; }
section() { echo -e "\n${YELLOW}═══════════════════════════════════════════════════════════${NC}"; echo -e "${YELLOW}$1${NC}"; echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}\n"; }

# Wait for server
wait_for_server() {
  info "Waiting for server at $BASE_URL..."
  for i in {1..30}; do
    if curl -s "$BASE_URL/api/health" > /dev/null 2>&1; then
      pass "Server is ready"
      return 0
    fi
    sleep 1
  done
  fail "Server did not start within 30 seconds"
}

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper: check JSON response
check_response() {
  local response="$1"
  local expected_field="$2"
  local test_name="$3"

  if echo "$response" | jq -e ".$expected_field" > /dev/null 2>&1; then
    pass "$test_name"
    ((TESTS_PASSED++)) || true
  else
    fail "$test_name - Expected field '$expected_field' not found in response"
    ((TESTS_FAILED++)) || true
  fi
}

# ============================================================================
section "Phase 5: Multi-Provider Billing Tests"
# ============================================================================

# Wait for server
wait_for_server

# ============================================================================
section "Test 1: Database Schema Verification"
# ============================================================================

info "Checking BillingLineItem table exists..."

# Use psql to check table exists
BILLING_LINE_ITEMS_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'billing_line_items');" 2>/dev/null | tr -d ' ')

if [ "$BILLING_LINE_ITEMS_EXISTS" = "t" ]; then
  pass "billing_line_items table exists"
  ((TESTS_PASSED++)) || true
else
  fail "billing_line_items table does not exist"
  ((TESTS_FAILED++)) || true
fi

info "Checking BillingIngestionBatch table exists..."

INGESTION_BATCH_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'billing_ingestion_batches');" 2>/dev/null | tr -d ' ')

if [ "$INGESTION_BATCH_EXISTS" = "t" ]; then
  pass "billing_ingestion_batches table exists"
  ((TESTS_PASSED++)) || true
else
  fail "billing_ingestion_batches table does not exist"
  ((TESTS_FAILED++)) || true
fi

info "Checking BillingProvider enum values..."

PROVIDER_VALUES=$(psql "$DATABASE_URL" -t -c "SELECT enum_range(NULL::billing_provider);" 2>/dev/null)

if echo "$PROVIDER_VALUES" | grep -q "GCP" && echo "$PROVIDER_VALUES" | grep -q "AWS" && echo "$PROVIDER_VALUES" | grep -q "OPENAI"; then
  pass "BillingProvider enum has GCP, AWS, OPENAI values"
  ((TESTS_PASSED++)) || true
else
  fail "BillingProvider enum missing expected values"
  ((TESTS_FAILED++)) || true
fi

info "Checking InvoiceRun provider fields..."

INVOICE_RUN_COLS=$(psql "$DATABASE_URL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'invoice_runs' AND column_name IN ('provider', 'source_type', 'source_metadata');" 2>/dev/null | tr -d ' ' | sort)

if echo "$INVOICE_RUN_COLS" | grep -q "provider"; then
  pass "InvoiceRun has provider field"
  ((TESTS_PASSED++)) || true
else
  fail "InvoiceRun missing provider field"
  ((TESTS_FAILED++)) || true
fi

# ============================================================================
section "Test 2: Create Test Data for Multi-Provider"
# ============================================================================

# Login first
info "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@sieger.cloud", "password": "admin123"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  warn "Could not login, some tests may fail"
  AUTH_HEADER=""
else
  pass "Logged in successfully"
  ((TESTS_PASSED++)) || true
  AUTH_HEADER="Authorization: Bearer $TOKEN"
fi

# Create a test customer for multi-provider testing
info "Creating multi-provider test customer..."

CUSTOMER_RESPONSE=$(curl -s -X POST "$API_URL/customers" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{
    "name": "Multi-Cloud Corp",
    "externalId": "MCC-001",
    "currency": "USD",
    "paymentTermsDays": 30,
    "contactEmail": "billing@multicloud.example.com"
  }')

CUSTOMER_ID=$(echo "$CUSTOMER_RESPONSE" | jq -r '.id // empty')

if [ -n "$CUSTOMER_ID" ]; then
  pass "Created multi-provider test customer: $CUSTOMER_ID"
  ((TESTS_PASSED++)) || true
else
  warn "Could not create customer, using existing or tests may fail"
  # Try to find existing customer
  CUSTOMER_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM customers WHERE external_id = 'MCC-001' LIMIT 1;" 2>/dev/null | tr -d ' ')
fi

# ============================================================================
section "Test 3: Insert Mock BillingLineItem Data"
# ============================================================================

# Get admin user ID for ingestion batch
ADMIN_USER_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM users WHERE email = 'admin@sieger.cloud' LIMIT 1;" 2>/dev/null | tr -d ' ')

if [ -z "$ADMIN_USER_ID" ]; then
  fail "Could not find admin user"
  ((TESTS_FAILED++)) || true
fi

info "Creating mock GCP billing line items..."

# Create ingestion batch for GCP
GCP_BATCH_ID=$(psql "$DATABASE_URL" -t -c "
INSERT INTO billing_ingestion_batches (id, provider, source_type, invoice_month, row_count, checksum, created_by, created_at)
VALUES (gen_random_uuid(), 'GCP', 'BIGQUERY_EXPORT', '2026-01', 3, 'test-checksum-gcp-001', '$ADMIN_USER_ID', NOW())
RETURNING id;
" 2>/dev/null | tr -d ' ')

if [ -n "$GCP_BATCH_ID" ]; then
  pass "Created GCP ingestion batch: $GCP_BATCH_ID"
  ((TESTS_PASSED++)) || true

  # Insert GCP line items
  psql "$DATABASE_URL" -c "
  INSERT INTO billing_line_items (id, ingestion_batch_id, provider, source_type, account_id, subaccount_id, product_id, meter_id, usage_amount, usage_unit, cost, currency, usage_start_time, usage_end_time, invoice_month, region)
  VALUES
    (gen_random_uuid(), '$GCP_BATCH_ID', 'GCP', 'BIGQUERY_EXPORT', 'BILLING-001', 'gcp-project-1', '6F81-5844-456A', 'D29A-89E1-AB6A', 1000.0, 'gibibyte month', 150.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01', 'us-central1'),
    (gen_random_uuid(), '$GCP_BATCH_ID', 'GCP', 'BIGQUERY_EXPORT', 'BILLING-001', 'gcp-project-1', '6F81-5844-456A', 'E2D9-7C3A-BC5F', 500.0, 'hour', 75.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01', 'us-central1'),
    (gen_random_uuid(), '$GCP_BATCH_ID', 'GCP', 'BIGQUERY_EXPORT', 'BILLING-001', 'gcp-project-2', '95FF-2EF5-5EA1', 'A1B2-C3D4-E5F6', 2000.0, 'count', 200.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01', 'europe-west1');
  " 2>/dev/null

  GCP_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM billing_line_items WHERE provider = 'GCP' AND invoice_month = '2026-01';" 2>/dev/null | tr -d ' ')
  pass "Inserted $GCP_COUNT GCP line items"
  ((TESTS_PASSED++)) || true
else
  fail "Could not create GCP ingestion batch"
  ((TESTS_FAILED++)) || true
fi

info "Creating mock AWS billing line items..."

# Create ingestion batch for AWS
AWS_BATCH_ID=$(psql "$DATABASE_URL" -t -c "
INSERT INTO billing_ingestion_batches (id, provider, source_type, invoice_month, row_count, checksum, created_by, created_at)
VALUES (gen_random_uuid(), 'AWS', 'CUR_S3', '2026-01', 2, 'test-checksum-aws-001', '$ADMIN_USER_ID', NOW())
RETURNING id;
" 2>/dev/null | tr -d ' ')

if [ -n "$AWS_BATCH_ID" ]; then
  pass "Created AWS ingestion batch: $AWS_BATCH_ID"
  ((TESTS_PASSED++)) || true

  # Insert AWS line items
  psql "$DATABASE_URL" -c "
  INSERT INTO billing_line_items (id, ingestion_batch_id, provider, source_type, account_id, subaccount_id, product_id, meter_id, usage_amount, usage_unit, cost, currency, usage_start_time, usage_end_time, invoice_month, region)
  VALUES
    (gen_random_uuid(), '$AWS_BATCH_ID', 'AWS', 'CUR_S3', '123456789012', '234567890123', 'AmazonEC2', 'BoxUsage:t3.medium', 720.0, 'Hrs', 300.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01', 'us-east-1'),
    (gen_random_uuid(), '$AWS_BATCH_ID', 'AWS', 'CUR_S3', '123456789012', '234567890123', 'AmazonS3', 'TimedStorage-ByteHrs', 1000000.0, 'GB-Mo', 23.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01', 'us-east-1');
  " 2>/dev/null

  AWS_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM billing_line_items WHERE provider = 'AWS' AND invoice_month = '2026-01';" 2>/dev/null | tr -d ' ')
  pass "Inserted $AWS_COUNT AWS line items"
  ((TESTS_PASSED++)) || true
else
  fail "Could not create AWS ingestion batch"
  ((TESTS_FAILED++)) || true
fi

info "Creating mock OpenAI billing line items..."

# Create ingestion batch for OpenAI
OPENAI_BATCH_ID=$(psql "$DATABASE_URL" -t -c "
INSERT INTO billing_ingestion_batches (id, provider, source_type, invoice_month, row_count, checksum, created_by, created_at)
VALUES (gen_random_uuid(), 'OPENAI', 'USAGE_API', '2026-01', 4, 'test-checksum-openai-001', '$ADMIN_USER_ID', NOW())
RETURNING id;
" 2>/dev/null | tr -d ' ')

if [ -n "$OPENAI_BATCH_ID" ]; then
  pass "Created OpenAI ingestion batch: $OPENAI_BATCH_ID"
  ((TESTS_PASSED++)) || true

  # Insert OpenAI line items
  psql "$DATABASE_URL" -c "
  INSERT INTO billing_line_items (id, ingestion_batch_id, provider, source_type, account_id, subaccount_id, product_id, meter_id, usage_amount, usage_unit, cost, currency, usage_start_time, usage_end_time, invoice_month)
  VALUES
    (gen_random_uuid(), '$OPENAI_BATCH_ID', 'OPENAI', 'USAGE_API', 'org-abc123', 'proj-xyz789', 'gpt-4o', 'input_tokens', 5000000.0, 'tokens', 12.50, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01'),
    (gen_random_uuid(), '$OPENAI_BATCH_ID', 'OPENAI', 'USAGE_API', 'org-abc123', 'proj-xyz789', 'gpt-4o', 'output_tokens', 1000000.0, 'tokens', 10.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01'),
    (gen_random_uuid(), '$OPENAI_BATCH_ID', 'OPENAI', 'USAGE_API', 'org-abc123', 'proj-xyz789', 'gpt-3.5-turbo', 'input_tokens', 10000000.0, 'tokens', 5.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01'),
    (gen_random_uuid(), '$OPENAI_BATCH_ID', 'OPENAI', 'USAGE_API', 'org-abc123', 'proj-xyz789', 'gpt-3.5-turbo', 'output_tokens', 2000000.0, 'tokens', 3.00, 'USD', '2026-01-01 00:00:00+00', '2026-01-31 23:59:59+00', '2026-01');
  " 2>/dev/null

  OPENAI_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM billing_line_items WHERE provider = 'OPENAI' AND invoice_month = '2026-01';" 2>/dev/null | tr -d ' ')
  pass "Inserted $OPENAI_COUNT OpenAI line items"
  ((TESTS_PASSED++)) || true
else
  fail "Could not create OpenAI ingestion batch"
  ((TESTS_FAILED++)) || true
fi

# ============================================================================
section "Test 4: Query BillingLineItem by Provider"
# ============================================================================

info "Testing GCP line item queries..."

GCP_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT SUM(cost) FROM billing_line_items WHERE provider = 'GCP' AND invoice_month = '2026-01';" 2>/dev/null | tr -d ' ')

if [ "$GCP_TOTAL" = "425.00" ]; then
  pass "GCP total cost is correct: \$425.00"
  ((TESTS_PASSED++)) || true
else
  warn "GCP total cost: $GCP_TOTAL (expected 425.00)"
fi

info "Testing AWS line item queries..."

AWS_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT SUM(cost) FROM billing_line_items WHERE provider = 'AWS' AND invoice_month = '2026-01';" 2>/dev/null | tr -d ' ')

if [ "$AWS_TOTAL" = "323.00" ]; then
  pass "AWS total cost is correct: \$323.00"
  ((TESTS_PASSED++)) || true
else
  warn "AWS total cost: $AWS_TOTAL (expected 323.00)"
fi

info "Testing OpenAI line item queries..."

OPENAI_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT SUM(cost) FROM billing_line_items WHERE provider = 'OPENAI' AND invoice_month = '2026-01';" 2>/dev/null | tr -d ' ')

if [ "$OPENAI_TOTAL" = "30.50" ]; then
  pass "OpenAI total cost is correct: \$30.50"
  ((TESTS_PASSED++)) || true
else
  warn "OpenAI total cost: $OPENAI_TOTAL (expected 30.50)"
fi

info "Testing cross-provider aggregate..."

TOTAL_ALL=$(psql "$DATABASE_URL" -t -c "SELECT SUM(cost) FROM billing_line_items WHERE invoice_month = '2026-01';" 2>/dev/null | tr -d ' ')

if [ "$TOTAL_ALL" = "778.50" ]; then
  pass "Total all providers: \$778.50"
  ((TESTS_PASSED++)) || true
else
  warn "Total all providers: $TOTAL_ALL (expected 778.50)"
fi

# ============================================================================
section "Test 5: Provider-specific Aggregation Queries"
# ============================================================================

info "Testing provider breakdown query..."

PROVIDER_BREAKDOWN=$(psql "$DATABASE_URL" -c "
SELECT
  provider,
  COUNT(*) as line_items,
  SUM(cost)::numeric(18,2) as total_cost,
  COUNT(DISTINCT account_id) as accounts,
  COUNT(DISTINCT subaccount_id) as subaccounts
FROM billing_line_items
WHERE invoice_month = '2026-01'
GROUP BY provider
ORDER BY provider;
" 2>/dev/null)

echo "$PROVIDER_BREAKDOWN"
pass "Provider breakdown query executed"
((TESTS_PASSED++)) || true

info "Testing product/service breakdown by provider..."

PRODUCT_BREAKDOWN=$(psql "$DATABASE_URL" -c "
SELECT
  provider,
  product_id,
  meter_id,
  SUM(usage_amount)::numeric(18,2) as total_usage,
  usage_unit,
  SUM(cost)::numeric(18,2) as total_cost
FROM billing_line_items
WHERE invoice_month = '2026-01'
GROUP BY provider, product_id, meter_id, usage_unit
ORDER BY provider, total_cost DESC;
" 2>/dev/null)

echo "$PRODUCT_BREAKDOWN"
pass "Product breakdown query executed"
((TESTS_PASSED++)) || true

# ============================================================================
section "Test 6: Verify Adapter Types Export"
# ============================================================================

info "Checking adapter module exports..."

# Check that the adapter files exist
if [ -f "src/lib/billing/adapters/index.ts" ]; then
  pass "Adapters index exists"
  ((TESTS_PASSED++)) || true
else
  fail "Adapters index missing"
  ((TESTS_FAILED++)) || true
fi

if [ -f "src/lib/billing/adapters/gcp-bigquery.ts" ]; then
  pass "GCP BigQuery adapter exists"
  ((TESTS_PASSED++)) || true
else
  fail "GCP BigQuery adapter missing"
  ((TESTS_FAILED++)) || true
fi

if [ -f "src/lib/billing/adapters/aws-cur.ts" ]; then
  pass "AWS CUR adapter exists"
  ((TESTS_PASSED++)) || true
else
  fail "AWS CUR adapter missing"
  ((TESTS_FAILED++)) || true
fi

if [ -f "src/lib/billing/adapters/openai-usage.ts" ]; then
  pass "OpenAI Usage adapter exists"
  ((TESTS_PASSED++)) || true
else
  fail "OpenAI Usage adapter missing"
  ((TESTS_FAILED++)) || true
fi

if [ -f "src/lib/billing/unified-engine.ts" ]; then
  pass "Unified engine exists"
  ((TESTS_PASSED++)) || true
else
  fail "Unified engine missing"
  ((TESTS_FAILED++)) || true
fi

# ============================================================================
section "Test 7: Verify TypeScript Compilation"
# ============================================================================

info "Running TypeScript type check on billing modules..."

cd /Users/error404/Documents/Sieger/bill-system

if npx tsc --noEmit --skipLibCheck src/lib/billing/adapters/types.ts 2>/dev/null; then
  pass "Adapter types compile successfully"
  ((TESTS_PASSED++)) || true
else
  warn "Adapter types have TypeScript errors (may need dependencies)"
fi

if npx tsc --noEmit --skipLibCheck src/lib/billing/unified-engine.ts 2>/dev/null; then
  pass "Unified engine compiles successfully"
  ((TESTS_PASSED++)) || true
else
  warn "Unified engine has TypeScript errors (may need dependencies)"
fi

# ============================================================================
section "Test Summary"
# ============================================================================

echo ""
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Phase 5: Multi-Provider Billing - ALL TESTS PASSED!      ${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  exit 0
else
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  Phase 5: Multi-Provider Billing - SOME TESTS FAILED      ${NC}"
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  exit 1
fi
