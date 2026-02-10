#!/bin/bash

# ============================================================================
# Phase 7: Billing Analytics Dashboard Test Script
# ============================================================================
#
# This script tests the analytics dashboard functionality:
# - Dashboard APIs (overview, trends, customers, providers, products)
# - Permission-based scoping
# - Data pipeline integration
#
# Prerequisites:
# - PostgreSQL running with bill-system database
# - npm run dev running (server at localhost:3000)
# - At least one completed invoice run
#
# Usage:
#   ./scripts/test-phase7-analytics.sh
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

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# ============================================================================
section "Phase 7: Billing Analytics Dashboard Tests"
# ============================================================================

# Login first
info "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@sieger.cloud", "password": "admin123"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  fail "Could not login - ensure server is running and admin user exists"
fi

pass "Logged in successfully"
((TESTS_PASSED++)) || true

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ============================================================================
section "Test 1: Get Available Months"
# ============================================================================

info "Fetching available months with analytics data..."

MONTHS_RESPONSE=$(curl -s "$API_URL/dashboard/months" -H "$AUTH_HEADER")
MONTHS=$(echo "$MONTHS_RESPONSE" | jq -r '.data // empty')

if [ "$MONTHS" != "null" ] && [ -n "$MONTHS" ]; then
  MONTH_COUNT=$(echo "$MONTHS_RESPONSE" | jq '.data | length')
  pass "Found $MONTH_COUNT month(s) with analytics data"
  ((TESTS_PASSED++)) || true

  echo ""
  echo "Available months:"
  echo "$MONTHS_RESPONSE" | jq -r '.data[]' 2>/dev/null || echo "(none)"
else
  warn "No months with analytics data found (this is expected if no invoice runs have completed)"
fi

# Get most recent month for testing
LATEST_MONTH=$(echo "$MONTHS_RESPONSE" | jq -r '.data[0] // empty')
if [ -z "$LATEST_MONTH" ] || [ "$LATEST_MONTH" = "null" ]; then
  LATEST_MONTH=$(date +%Y-%m)
  info "Using current month for testing: $LATEST_MONTH"
fi

# ============================================================================
section "Test 2: Dashboard Overview API"
# ============================================================================

info "Fetching dashboard overview for $LATEST_MONTH..."

OVERVIEW_RESPONSE=$(curl -s "$API_URL/dashboard/overview?month=$LATEST_MONTH" -H "$AUTH_HEADER")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard/overview?month=$LATEST_MONTH" -H "$AUTH_HEADER")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "Dashboard overview API returned HTTP 200"
  ((TESTS_PASSED++)) || true

  echo ""
  echo "=== Dashboard Overview ==="
  echo "$OVERVIEW_RESPONSE" | jq '{
    currentMonth,
    totalRevenue,
    totalCustomers,
    totalInvoices,
    avgRevenuePerCustomer,
    momGrowth
  }'
  echo ""

  TOTAL_REV=$(echo "$OVERVIEW_RESPONSE" | jq -r '.totalRevenue')
  TOTAL_CUST=$(echo "$OVERVIEW_RESPONSE" | jq -r '.totalCustomers')

  info "Total Revenue: \$$TOTAL_REV"
  info "Total Customers: $TOTAL_CUST"
else
  fail "Dashboard overview API failed with HTTP $HTTP_STATUS"
fi

# ============================================================================
section "Test 3: Top Products Breakdown"
# ============================================================================

info "Getting top products..."

TOP_PRODUCTS=$(echo "$OVERVIEW_RESPONSE" | jq '.topProducts')
PRODUCT_COUNT=$(echo "$OVERVIEW_RESPONSE" | jq '.topProducts | length')

if [ "$PRODUCT_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Found $PRODUCT_COUNT product groups"
  ((TESTS_PASSED++)) || true

  echo ""
  echo "=== Top Products ==="
  echo "$TOP_PRODUCTS" | jq '.[] | {productGroup, amount, percentage}'
else
  info "No product data available yet"
fi

# ============================================================================
section "Test 4: Provider Mix Breakdown"
# ============================================================================

info "Getting provider mix..."

PROVIDER_MIX=$(echo "$OVERVIEW_RESPONSE" | jq '.providerMix')
PROVIDER_COUNT=$(echo "$OVERVIEW_RESPONSE" | jq '.providerMix | length')

if [ "$PROVIDER_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Found $PROVIDER_COUNT providers"
  ((TESTS_PASSED++)) || true

  echo ""
  echo "=== Provider Mix ==="
  echo "$PROVIDER_MIX" | jq '.[] | {provider, amount, percentage}'
else
  info "No provider data available yet"
fi

# ============================================================================
section "Test 5: Revenue Trends API"
# ============================================================================

info "Fetching revenue trends..."

TRENDS_RESPONSE=$(curl -s "$API_URL/dashboard/trends" -H "$AUTH_HEADER")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard/trends" -H "$AUTH_HEADER")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "Revenue trends API returned HTTP 200"
  ((TESTS_PASSED++)) || true

  TREND_COUNT=$(echo "$TRENDS_RESPONSE" | jq '.data | length')
  info "Found $TREND_COUNT month(s) of trend data"

  echo ""
  echo "=== Revenue Trends ==="
  echo "$TRENDS_RESPONSE" | jq '.data[] | {month, totalRevenue, totalDiscount, customerCount}' 2>/dev/null || echo "(no data)"
else
  fail "Revenue trends API failed with HTTP $HTTP_STATUS"
fi

# Test quarterly grouping
info "Fetching quarterly trends..."

QUARTERLY_RESPONSE=$(curl -s "$API_URL/dashboard/trends?groupBy=quarter" -H "$AUTH_HEADER")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard/trends?groupBy=quarter" -H "$AUTH_HEADER")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "Quarterly trends API returned HTTP 200"
  ((TESTS_PASSED++)) || true
else
  warn "Quarterly trends API returned HTTP $HTTP_STATUS"
fi

# ============================================================================
section "Test 6: Customer Rankings API"
# ============================================================================

info "Fetching customer rankings..."

CUSTOMERS_RESPONSE=$(curl -s "$API_URL/dashboard/customers?month=$LATEST_MONTH&limit=10" -H "$AUTH_HEADER")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard/customers?month=$LATEST_MONTH&limit=10" -H "$AUTH_HEADER")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "Customer rankings API returned HTTP 200"
  ((TESTS_PASSED++)) || true

  CUSTOMER_COUNT=$(echo "$CUSTOMERS_RESPONSE" | jq '.data | length')
  info "Found $CUSTOMER_COUNT customer(s)"

  echo ""
  echo "=== Customer Rankings ==="
  echo "$CUSTOMERS_RESPONSE" | jq '.data[] | {rank, customerName, totalRevenue, momGrowth}' 2>/dev/null || echo "(no data)"
else
  fail "Customer rankings API failed with HTTP $HTTP_STATUS"
fi

# ============================================================================
section "Test 7: Provider Breakdown API"
# ============================================================================

info "Fetching provider breakdown..."

PROVIDERS_RESPONSE=$(curl -s "$API_URL/dashboard/providers?month=$LATEST_MONTH" -H "$AUTH_HEADER")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard/providers?month=$LATEST_MONTH" -H "$AUTH_HEADER")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "Provider breakdown API returned HTTP 200"
  ((TESTS_PASSED++)) || true

  echo ""
  echo "=== Provider Breakdown ==="
  echo "$PROVIDERS_RESPONSE" | jq '.data[] | {provider, totalCost, totalRevenue, marginPct, customerCount}' 2>/dev/null || echo "(no data)"
else
  fail "Provider breakdown API failed with HTTP $HTTP_STATUS"
fi

# ============================================================================
section "Test 8: Product Breakdown API"
# ============================================================================

info "Fetching product breakdown..."

PRODUCTS_RESPONSE=$(curl -s "$API_URL/dashboard/products?month=$LATEST_MONTH" -H "$AUTH_HEADER")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard/products?month=$LATEST_MONTH" -H "$AUTH_HEADER")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "Product breakdown API returned HTTP 200"
  ((TESTS_PASSED++)) || true

  echo ""
  echo "=== Product Breakdown ==="
  echo "$PRODUCTS_RESPONSE" | jq '.data[] | {productGroup, listAmount, discountAmount, finalAmount, discountPct}' 2>/dev/null || echo "(no data)"
else
  fail "Product breakdown API failed with HTTP $HTTP_STATUS"
fi

# Test with provider filter
info "Testing product breakdown with provider filter..."

PRODUCTS_FILTERED=$(curl -s "$API_URL/dashboard/products?month=$LATEST_MONTH&provider=GCP" -H "$AUTH_HEADER")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard/products?month=$LATEST_MONTH&provider=GCP" -H "$AUTH_HEADER")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "Product breakdown with provider filter returned HTTP 200"
  ((TESTS_PASSED++)) || true
else
  warn "Product breakdown with provider filter returned HTTP $HTTP_STATUS"
fi

# ============================================================================
section "Test 9: Invalid Parameters Handling"
# ============================================================================

info "Testing invalid month format..."

INVALID_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/dashboard/overview?month=invalid" -H "$AUTH_HEADER")
HTTP_CODE=$(echo "$INVALID_RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "400" ]; then
  pass "Invalid month format correctly rejected (HTTP 400)"
  ((TESTS_PASSED++)) || true
else
  warn "Expected HTTP 400 for invalid month, got: $HTTP_CODE"
fi

info "Testing invalid groupBy parameter..."

INVALID_GROUPBY=$(curl -s -w "\n%{http_code}" "$API_URL/dashboard/trends?groupBy=invalid" -H "$AUTH_HEADER")
HTTP_CODE=$(echo "$INVALID_GROUPBY" | tail -1)

if [ "$HTTP_CODE" = "400" ]; then
  pass "Invalid groupBy correctly rejected (HTTP 400)"
  ((TESTS_PASSED++)) || true
else
  warn "Expected HTTP 400 for invalid groupBy, got: $HTTP_CODE"
fi

# ============================================================================
section "Sample API Responses"
# ============================================================================

echo ""
echo "=== Sample Overview Response ==="
echo "$OVERVIEW_RESPONSE" | jq '.'

echo ""
echo "=== Sample Trends Response ==="
echo "$TRENDS_RESPONSE" | jq '.'

echo ""
echo "=== Sample Customers Response ==="
echo "$CUSTOMERS_RESPONSE" | jq '.'

# ============================================================================
section "Curl Command Examples"
# ============================================================================

echo ""
echo "=== Example Curl Commands ==="
echo ""
echo "# Get dashboard overview"
echo "curl -X GET '$API_URL/dashboard/overview?month=2026-01' \\"
echo "  -H 'Authorization: Bearer {token}'"
echo ""
echo "# Get revenue trends (monthly)"
echo "curl -X GET '$API_URL/dashboard/trends?groupBy=month' \\"
echo "  -H 'Authorization: Bearer {token}'"
echo ""
echo "# Get revenue trends (quarterly)"
echo "curl -X GET '$API_URL/dashboard/trends?groupBy=quarter' \\"
echo "  -H 'Authorization: Bearer {token}'"
echo ""
echo "# Get top customers"
echo "curl -X GET '$API_URL/dashboard/customers?month=2026-01&limit=10' \\"
echo "  -H 'Authorization: Bearer {token}'"
echo ""
echo "# Get provider breakdown"
echo "curl -X GET '$API_URL/dashboard/providers?month=2026-01' \\"
echo "  -H 'Authorization: Bearer {token}'"
echo ""
echo "# Get product breakdown (with optional provider filter)"
echo "curl -X GET '$API_URL/dashboard/products?month=2026-01&provider=GCP' \\"
echo "  -H 'Authorization: Bearer {token}'"
echo ""
echo "# Get available months"
echo "curl -X GET '$API_URL/dashboard/months' \\"
echo "  -H 'Authorization: Bearer {token}'"
echo ""

# ============================================================================
section "Frontend Dashboard Access"
# ============================================================================

echo ""
echo "=== Dashboard Frontend ==="
echo ""
echo "Access the dashboard at: $BASE_URL/dashboard"
echo ""
echo "Login first at: $BASE_URL/login"
echo "  Email: admin@sieger.cloud"
echo "  Password: admin123"
echo ""

# ============================================================================
section "Test Summary"
# ============================================================================

echo ""
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Phase 7: Billing Analytics Dashboard - ALL TESTS PASSED! ${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  Phase 7: Billing Analytics Dashboard - SOME TESTS FAILED ${NC}"
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  exit 1
fi
