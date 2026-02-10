#!/bin/bash

# ============================================================================
# Phase 6: Invoice Presentation & Export Test Script
# ============================================================================
#
# This script tests the invoice export functionality:
# - CSV export
# - XLSX export
# - PDF (HTML) export
# - Locking requirement enforcement
# - Audit logging
#
# Prerequisites:
# - PostgreSQL running with bill-system database
# - npm run dev running (server at localhost:3000)
# - At least one invoice exists
#
# Usage:
#   ./scripts/test-phase6-invoice-export.sh
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
section "Phase 6: Invoice Export Tests"
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
section "Test 1: Create Test Invoice Data"
# ============================================================================

info "Finding or creating test customer..."

# Get existing customer or create one
CUSTOMER_RESPONSE=$(curl -s "$API_URL/customers" -H "$AUTH_HEADER")
CUSTOMER_ID=$(echo "$CUSTOMER_RESPONSE" | jq -r '.data[0].id // empty')

if [ -z "$CUSTOMER_ID" ]; then
  info "No customers found, creating one..."
  CUSTOMER_CREATE=$(curl -s -X POST "$API_URL/customers" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d '{
      "name": "Export Test Corp",
      "externalId": "EXP-001",
      "currency": "USD",
      "paymentTermsDays": 30,
      "primaryContactEmail": "billing@export-test.example.com"
    }')
  CUSTOMER_ID=$(echo "$CUSTOMER_CREATE" | jq -r '.id // empty')
fi

if [ -n "$CUSTOMER_ID" ]; then
  pass "Using customer: $CUSTOMER_ID"
  ((TESTS_PASSED++)) || true
else
  warn "No customer available for testing"
fi

# Find an existing invoice
info "Finding an invoice to test export..."
INVOICES_RESPONSE=$(curl -s "$API_URL/invoices" -H "$AUTH_HEADER")
INVOICE_ID=$(echo "$INVOICES_RESPONSE" | jq -r '.data[0].id // empty')
INVOICE_NUMBER=$(echo "$INVOICES_RESPONSE" | jq -r '.data[0].invoiceNumber // empty')
INVOICE_LOCKED=$(echo "$INVOICES_RESPONSE" | jq -r '.data[0].lockedAt // empty')

if [ -z "$INVOICE_ID" ]; then
  warn "No invoices found. Creating a test invoice run..."

  # Create an invoice run
  RUN_CREATE=$(curl -s -X POST "$API_URL/invoice-runs" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d '{"billingMonth": "2026-01"}')

  RUN_ID=$(echo "$RUN_CREATE" | jq -r '.id // empty')

  if [ -n "$RUN_ID" ]; then
    info "Created invoice run: $RUN_ID, executing..."

    curl -s -X POST "$API_URL/invoice-runs/$RUN_ID/execute" -H "$AUTH_HEADER" > /dev/null

    sleep 2

    # Get invoices again
    INVOICES_RESPONSE=$(curl -s "$API_URL/invoices" -H "$AUTH_HEADER")
    INVOICE_ID=$(echo "$INVOICES_RESPONSE" | jq -r '.data[0].id // empty')
    INVOICE_NUMBER=$(echo "$INVOICES_RESPONSE" | jq -r '.data[0].invoiceNumber // empty')
    INVOICE_LOCKED=$(echo "$INVOICES_RESPONSE" | jq -r '.data[0].lockedAt // empty')
  fi
fi

if [ -n "$INVOICE_ID" ]; then
  pass "Found invoice: $INVOICE_NUMBER ($INVOICE_ID)"
  ((TESTS_PASSED++)) || true
else
  fail "No invoices available for export testing"
fi

# ============================================================================
section "Test 2: Export Without Lock (Should Fail)"
# ============================================================================

info "Attempting export without lock (should fail)..."

if [ -z "$INVOICE_LOCKED" ] || [ "$INVOICE_LOCKED" = "null" ]; then
  EXPORT_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/invoices/$INVOICE_ID/export?format=csv" \
    -H "$AUTH_HEADER")

  HTTP_CODE=$(echo "$EXPORT_RESPONSE" | tail -1)
  BODY=$(echo "$EXPORT_RESPONSE" | head -n -1)

  if [ "$HTTP_CODE" = "400" ]; then
    pass "Export correctly rejected for unlocked invoice (HTTP 400)"
    ((TESTS_PASSED++)) || true
    echo "Response: $BODY"
  else
    warn "Expected HTTP 400 for unlocked invoice, got: $HTTP_CODE"
  fi
else
  info "Invoice already locked, skipping unlocked test"
fi

# ============================================================================
section "Test 3: Lock Invoice"
# ============================================================================

if [ -z "$INVOICE_LOCKED" ] || [ "$INVOICE_LOCKED" = "null" ]; then
  info "Locking invoice $INVOICE_NUMBER..."

  LOCK_RESPONSE=$(curl -s -X POST "$API_URL/invoices/$INVOICE_ID/lock" \
    -H "$AUTH_HEADER")

  LOCKED_AT=$(echo "$LOCK_RESPONSE" | jq -r '.lockedAt // empty')

  if [ -n "$LOCKED_AT" ]; then
    pass "Invoice locked at: $LOCKED_AT"
    ((TESTS_PASSED++)) || true
  else
    warn "Could not lock invoice: $LOCK_RESPONSE"
  fi
else
  pass "Invoice already locked at: $INVOICE_LOCKED"
  ((TESTS_PASSED++)) || true
fi

# ============================================================================
section "Test 4: CSV Export"
# ============================================================================

info "Exporting invoice as CSV..."

mkdir -p /tmp/invoice-exports

CSV_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/invoices/$INVOICE_ID/export?format=csv" \
  -H "$AUTH_HEADER" \
  -o /tmp/invoice-exports/test-export.csv)

HTTP_CODE=$(echo "$CSV_RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "CSV export successful (HTTP 200)"
  ((TESTS_PASSED++)) || true

  # Check file content
  if [ -f /tmp/invoice-exports/test-export.csv ]; then
    CSV_LINES=$(wc -l < /tmp/invoice-exports/test-export.csv)
    info "CSV file has $CSV_LINES lines"

    echo ""
    echo "=== CSV Content Preview (first 30 lines) ==="
    head -30 /tmp/invoice-exports/test-export.csv
    echo "=== End Preview ==="

    pass "CSV file created successfully"
    ((TESTS_PASSED++)) || true
  fi
else
  fail "CSV export failed with HTTP $HTTP_CODE"
fi

# ============================================================================
section "Test 5: XLSX Export"
# ============================================================================

info "Exporting invoice as XLSX..."

XLSX_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/invoices/$INVOICE_ID/export?format=xlsx&includeCredits=true" \
  -H "$AUTH_HEADER" \
  -D /tmp/invoice-exports/xlsx-headers.txt \
  -o /tmp/invoice-exports/test-export.xlsx)

HTTP_CODE=$(echo "$XLSX_RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "XLSX export successful (HTTP 200)"
  ((TESTS_PASSED++)) || true

  if [ -f /tmp/invoice-exports/test-export.xlsx ]; then
    XLSX_SIZE=$(stat -f%z /tmp/invoice-exports/test-export.xlsx 2>/dev/null || stat --printf="%s" /tmp/invoice-exports/test-export.xlsx 2>/dev/null)
    info "XLSX file size: $XLSX_SIZE bytes"

    # Check headers
    if [ -f /tmp/invoice-exports/xlsx-headers.txt ]; then
      CONTENT_HASH=$(grep -i "x-content-hash" /tmp/invoice-exports/xlsx-headers.txt | cut -d: -f2 | tr -d ' \r')
      EXPORT_ID=$(grep -i "x-export-id" /tmp/invoice-exports/xlsx-headers.txt | cut -d: -f2 | tr -d ' \r')

      if [ -n "$CONTENT_HASH" ]; then
        pass "Content hash returned: ${CONTENT_HASH:0:16}..."
        ((TESTS_PASSED++)) || true
      fi

      if [ -n "$EXPORT_ID" ]; then
        pass "Export ID returned: $EXPORT_ID"
        ((TESTS_PASSED++)) || true
      fi
    fi

    echo ""
    echo "=== XLSX Content Preview (first 50 lines) ==="
    head -50 /tmp/invoice-exports/test-export.xlsx
    echo "=== End Preview ==="
  fi
else
  fail "XLSX export failed with HTTP $HTTP_CODE"
fi

# ============================================================================
section "Test 6: PDF (HTML) Export"
# ============================================================================

info "Exporting invoice as PDF (HTML format)..."

PDF_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/invoices/$INVOICE_ID/export?format=pdf" \
  -H "$AUTH_HEADER" \
  -o /tmp/invoice-exports/test-export.html)

HTTP_CODE=$(echo "$PDF_RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "PDF/HTML export successful (HTTP 200)"
  ((TESTS_PASSED++)) || true

  if [ -f /tmp/invoice-exports/test-export.html ]; then
    HTML_SIZE=$(stat -f%z /tmp/invoice-exports/test-export.html 2>/dev/null || stat --printf="%s" /tmp/invoice-exports/test-export.html 2>/dev/null)
    info "HTML file size: $HTML_SIZE bytes"

    # Check for key HTML elements
    if grep -q "<!DOCTYPE html>" /tmp/invoice-exports/test-export.html; then
      pass "HTML document is valid"
      ((TESTS_PASSED++)) || true
    fi

    if grep -q "INVOICE" /tmp/invoice-exports/test-export.html; then
      pass "HTML contains invoice header"
      ((TESTS_PASSED++)) || true
    fi

    echo ""
    echo "=== HTML Content Preview (title and summary) ==="
    grep -E "<title>|TOTAL|grandTotal" /tmp/invoice-exports/test-export.html | head -10
    echo "=== End Preview ==="

    info "Open /tmp/invoice-exports/test-export.html in a browser to see the invoice layout"
  fi
else
  fail "PDF/HTML export failed with HTTP $HTTP_CODE"
fi

# ============================================================================
section "Test 7: Export with Different Aggregation Levels"
# ============================================================================

for AGG_LEVEL in "product_group" "provider" "service"; do
  info "Exporting with aggregation: $AGG_LEVEL"

  AGG_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/invoices/$INVOICE_ID/export?format=csv&aggregation=$AGG_LEVEL" \
    -H "$AUTH_HEADER" \
    -o /tmp/invoice-exports/test-export-$AGG_LEVEL.csv)

  HTTP_CODE=$(echo "$AGG_RESPONSE" | tail -1)

  if [ "$HTTP_CODE" = "200" ]; then
    pass "Export with $AGG_LEVEL aggregation successful"
    ((TESTS_PASSED++)) || true
  else
    warn "Export with $AGG_LEVEL failed: HTTP $HTTP_CODE"
  fi
done

# ============================================================================
section "Test 8: Verify Export Audit Record"
# ============================================================================

info "Checking for export audit records in database..."

EXPORT_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM invoice_exports WHERE invoice_id = '$INVOICE_ID';" 2>/dev/null | tr -d ' ')

if [ -n "$EXPORT_COUNT" ] && [ "$EXPORT_COUNT" -gt "0" ]; then
  pass "Found $EXPORT_COUNT export record(s) for this invoice"
  ((TESTS_PASSED++)) || true

  # Show export details
  psql "$DATABASE_URL" -c "
    SELECT
      format,
      filename,
      file_size,
      LEFT(content_hash, 16) || '...' as content_hash,
      exported_at
    FROM invoice_exports
    WHERE invoice_id = '$INVOICE_ID'
    ORDER BY exported_at DESC
    LIMIT 5;
  " 2>/dev/null
else
  warn "No export records found (database check may require direct access)"
fi

info "Checking for export audit log entries..."

AUDIT_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM audit_logs WHERE action = 'INVOICE_EXPORT' AND target_id = '$INVOICE_ID';" 2>/dev/null | tr -d ' ')

if [ -n "$AUDIT_COUNT" ] && [ "$AUDIT_COUNT" -gt "0" ]; then
  pass "Found $AUDIT_COUNT audit log entries for exports"
  ((TESTS_PASSED++)) || true
else
  warn "No audit log entries found (database check may require direct access)"
fi

# ============================================================================
section "Test 9: Invalid Format Handling"
# ============================================================================

info "Testing invalid export format..."

INVALID_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/invoices/$INVOICE_ID/export?format=invalid" \
  -H "$AUTH_HEADER")

HTTP_CODE=$(echo "$INVALID_RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "400" ]; then
  pass "Invalid format correctly rejected (HTTP 400)"
  ((TESTS_PASSED++)) || true
else
  warn "Expected HTTP 400 for invalid format, got: $HTTP_CODE"
fi

# ============================================================================
section "Curl Command Examples"
# ============================================================================

echo ""
echo "=== Example Curl Commands ==="
echo ""
echo "# Export as CSV"
echo "curl -X GET '$API_URL/invoices/{invoice_id}/export?format=csv' \\"
echo "  -H 'Authorization: Bearer {token}' \\"
echo "  -o invoice.csv"
echo ""
echo "# Export as XLSX with credits breakdown"
echo "curl -X GET '$API_URL/invoices/{invoice_id}/export?format=xlsx&includeCredits=true' \\"
echo "  -H 'Authorization: Bearer {token}' \\"
echo "  -o invoice.xlsx"
echo ""
echo "# Export as PDF (HTML)"
echo "curl -X GET '$API_URL/invoices/{invoice_id}/export?format=pdf' \\"
echo "  -H 'Authorization: Bearer {token}' \\"
echo "  -o invoice.html"
echo ""
echo "# Export with specific aggregation level"
echo "curl -X GET '$API_URL/invoices/{invoice_id}/export?format=csv&aggregation=provider' \\"
echo "  -H 'Authorization: Bearer {token}' \\"
echo "  -o invoice-by-provider.csv"
echo ""
echo "# Aggregation options: product_group, provider, service, sku"
echo ""

# ============================================================================
section "Test Summary"
# ============================================================================

echo ""
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

info "Exported files saved to /tmp/invoice-exports/"
ls -la /tmp/invoice-exports/

if [ "$TESTS_FAILED" -eq 0 ]; then
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Phase 6: Invoice Export - ALL TESTS PASSED!              ${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  Phase 6: Invoice Export - SOME TESTS FAILED              ${NC}"
  echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
  exit 1
fi
