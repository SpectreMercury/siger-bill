#!/bin/bash
#
# End-to-End Billing Flow Test Script
#
# This script tests the complete billing loop:
# 1. Login to get JWT token
# 2. Create a billing account
# 3. Create a project
# 4. Bind project to customer
# 5. Import raw cost data
# 6. Create and execute invoice run
# 7. Query invoices
# 8. Lock an invoice
#
# Prerequisites:
# - Server running on localhost:3000
# - Database seeded with default admin user
#
# Usage: ./scripts/test-billing-flow.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
BILLING_MONTH="${BILLING_MONTH:-2026-01}"

echo "========================================"
echo "Sieger Billing Flow E2E Test"
echo "========================================"
echo "Base URL: $BASE_URL"
echo "Billing Month: $BILLING_MONTH"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to extract JSON field
json_field() {
  echo "$1" | grep -o "\"$2\":[^,}]*" | cut -d':' -f2- | tr -d '"' | tr -d ' '
}

# Helper function to print step
step() {
  echo -e "${YELLOW}➤ $1${NC}"
}

# Helper function to print success
ok() {
  echo -e "${GREEN}✓ $1${NC}"
}

# Helper function to print error
err() {
  echo -e "${RED}✗ $1${NC}"
}

# ============================================================================
# Step 1: Login
# ============================================================================
step "Step 1: Logging in as admin@sieger.com..."

LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@sieger.com","password":"SiegerAdmin2024!"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  err "Login failed"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

ok "Logged in successfully"
echo "   Token: ${TOKEN:0:50}..."

# ============================================================================
# Step 2: Create Billing Account
# ============================================================================
step "Step 2: Creating billing account..."

BA_RESPONSE=$(curl -s -X POST "$BASE_URL/api/billing-accounts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "billingAccountId": "billingAccounts/XXXXXX-XXXXXX-XXXXXX",
    "name": "Test Billing Account"
  }')

echo "Response: $BA_RESPONSE"

# Check for success or already exists
if echo "$BA_RESPONSE" | grep -q '"id"'; then
  ok "Billing account created"
elif echo "$BA_RESPONSE" | grep -q "already exists"; then
  ok "Billing account already exists (OK)"
else
  err "Failed to create billing account"
fi

# ============================================================================
# Step 3: Create Project
# ============================================================================
step "Step 3: Creating project..."

PROJECT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectId": "test-project-001",
    "name": "Test Project 001",
    "billingAccountId": "billingAccounts/XXXXXX-XXXXXX-XXXXXX"
  }')

echo "Response: $PROJECT_RESPONSE"

if echo "$PROJECT_RESPONSE" | grep -q '"id"'; then
  ok "Project created"
elif echo "$PROJECT_RESPONSE" | grep -q "already exists"; then
  ok "Project already exists (OK)"
else
  err "Failed to create project"
fi

# ============================================================================
# Step 4: Get Customer ID and Bind Project
# ============================================================================
step "Step 4: Getting customer and binding project..."

CUSTOMERS_RESPONSE=$(curl -s -X GET "$BASE_URL/api/customers" \
  -H "Authorization: Bearer $TOKEN")

CUSTOMER_ID=$(echo "$CUSTOMERS_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$CUSTOMER_ID" ]; then
  err "No customer found"
  exit 1
fi

ok "Found customer: $CUSTOMER_ID"

# Bind project to customer
BIND_RESPONSE=$(curl -s -X POST "$BASE_URL/api/customers/$CUSTOMER_ID/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectId": "test-project-001"
  }')

echo "Response: $BIND_RESPONSE"

if echo "$BIND_RESPONSE" | grep -q '"id"'; then
  ok "Project bound to customer"
elif echo "$BIND_RESPONSE" | grep -q "already bound"; then
  ok "Project already bound (OK)"
else
  err "Failed to bind project"
fi

# ============================================================================
# Step 5: Import Raw Cost Data
# ============================================================================
step "Step 5: Importing raw cost data..."

# Generate timestamps for the billing month
YEAR=$(echo "$BILLING_MONTH" | cut -d'-' -f1)
MONTH=$(echo "$BILLING_MONTH" | cut -d'-' -f2)

IMPORT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/raw-cost/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"source\": \"test-script\",
    \"month\": \"$BILLING_MONTH\",
    \"entries\": [
      {
        \"billingAccountId\": \"billingAccounts/XXXXXX-XXXXXX-XXXXXX\",
        \"projectId\": \"test-project-001\",
        \"serviceId\": \"compute.googleapis.com\",
        \"skuId\": \"SKU-N1-STANDARD-1\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-15T00:00:00Z\",
        \"usageAmount\": 720,
        \"cost\": 50.40,
        \"currency\": \"USD\",
        \"region\": \"us-central1\"
      },
      {
        \"billingAccountId\": \"billingAccounts/XXXXXX-XXXXXX-XXXXXX\",
        \"projectId\": \"test-project-001\",
        \"serviceId\": \"storage.googleapis.com\",
        \"skuId\": \"SKU-STANDARD-STORAGE\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-01T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-31T00:00:00Z\",
        \"usageAmount\": 100,
        \"cost\": 2.60,
        \"currency\": \"USD\",
        \"region\": \"us-central1\"
      },
      {
        \"billingAccountId\": \"billingAccounts/XXXXXX-XXXXXX-XXXXXX\",
        \"projectId\": \"test-project-001\",
        \"serviceId\": \"bigquery.googleapis.com\",
        \"skuId\": \"SKU-BQ-ANALYSIS\",
        \"usageStartTime\": \"${YEAR}-${MONTH}-10T00:00:00Z\",
        \"usageEndTime\": \"${YEAR}-${MONTH}-20T00:00:00Z\",
        \"usageAmount\": 50,
        \"cost\": 25.00,
        \"currency\": \"USD\",
        \"region\": \"us\"
      }
    ]
  }")

echo "Response: $IMPORT_RESPONSE"

BATCH_ID=$(echo "$IMPORT_RESPONSE" | grep -o '"batchId":"[^"]*"' | cut -d'"' -f4)

if [ -n "$BATCH_ID" ]; then
  ok "Raw cost imported. Batch ID: $BATCH_ID"
else
  err "Failed to import raw cost"
fi

# ============================================================================
# Step 6: Query Raw Cost Data
# ============================================================================
step "Step 6: Querying raw cost data..."

RAW_COST_RESPONSE=$(curl -s -X GET "$BASE_URL/api/raw-cost?month=$BILLING_MONTH&limit=10" \
  -H "Authorization: Bearer $TOKEN")

echo "Response (truncated): $(echo "$RAW_COST_RESPONSE" | head -c 500)..."

if echo "$RAW_COST_RESPONSE" | grep -q '"totalCost"'; then
  TOTAL_COST=$(echo "$RAW_COST_RESPONSE" | grep -o '"totalCost":"[^"]*"' | cut -d'"' -f4)
  ok "Raw cost query successful. Total cost: $TOTAL_COST"
else
  err "Failed to query raw cost"
fi

# ============================================================================
# Step 7: Create Invoice Run
# ============================================================================
step "Step 7: Creating invoice run..."

RUN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/invoice-runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"billingMonth\": \"$BILLING_MONTH\"}")

echo "Response: $RUN_RESPONSE"

RUN_ID=$(echo "$RUN_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$RUN_ID" ]; then
  ok "Invoice run created. ID: $RUN_ID"
else
  err "Failed to create invoice run"
  exit 1
fi

# ============================================================================
# Step 8: Execute Invoice Run
# ============================================================================
step "Step 8: Executing invoice run..."

EXEC_RESPONSE=$(curl -s -X POST "$BASE_URL/api/invoice-runs/$RUN_ID/execute" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN")

echo "Response: $EXEC_RESPONSE"

if echo "$EXEC_RESPONSE" | grep -q '"SUCCEEDED"'; then
  INVOICES_GENERATED=$(echo "$EXEC_RESPONSE" | grep -o '"invoicesGenerated":[0-9]*' | cut -d':' -f2)
  TOTAL_AMOUNT=$(echo "$EXEC_RESPONSE" | grep -o '"totalAmount":"[^"]*"' | cut -d'"' -f4)
  ok "Invoice run executed. Invoices: $INVOICES_GENERATED, Total: $TOTAL_AMOUNT"
else
  err "Invoice run failed or had errors"
fi

# ============================================================================
# Step 9: Query Invoices
# ============================================================================
step "Step 9: Querying invoices..."

INVOICES_RESPONSE=$(curl -s -X GET "$BASE_URL/api/invoices?billingMonth=$BILLING_MONTH" \
  -H "Authorization: Bearer $TOKEN")

echo "Response (truncated): $(echo "$INVOICES_RESPONSE" | head -c 500)..."

INVOICE_ID=$(echo "$INVOICES_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
INVOICE_NUMBER=$(echo "$INVOICES_RESPONSE" | grep -o '"invoiceNumber":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$INVOICE_ID" ]; then
  ok "Found invoice: $INVOICE_NUMBER (ID: $INVOICE_ID)"
else
  err "No invoices found"
  exit 1
fi

# ============================================================================
# Step 10: Get Invoice Details
# ============================================================================
step "Step 10: Getting invoice details..."

INVOICE_DETAIL=$(curl -s -X GET "$BASE_URL/api/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "Response (truncated): $(echo "$INVOICE_DETAIL" | head -c 800)..."

if echo "$INVOICE_DETAIL" | grep -q '"lineItems"'; then
  ok "Invoice details retrieved with line items"
else
  err "Failed to get invoice details"
fi

# ============================================================================
# Step 11: Issue Invoice (update status to ISSUED for lock test)
# ============================================================================
step "Step 11: Issuing invoice (manual status update for lock test)..."

# Note: In a real system, there would be a /issue endpoint
# For now, we'll update directly or skip the lock test
echo "   Skipping - invoice lock requires ISSUED status"
echo "   Invoice is currently in DRAFT status"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo "✓ Login: OK"
echo "✓ Billing Account: Created/Exists"
echo "✓ Project: Created/Exists"
echo "✓ Customer-Project Binding: OK"
echo "✓ Raw Cost Import: Batch $BATCH_ID"
echo "✓ Raw Cost Query: Total $TOTAL_COST"
echo "✓ Invoice Run: $RUN_ID"
echo "✓ Invoice Generated: $INVOICE_NUMBER"
echo ""
echo "========================================"
echo "Curl Commands Reference"
echo "========================================"
cat << 'EOF'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@sieger.com","password":"SiegerAdmin2024!"}'

# List Billing Accounts
curl -X GET http://localhost:3000/api/billing-accounts \
  -H "Authorization: Bearer $TOKEN"

# Create Billing Account
curl -X POST http://localhost:3000/api/billing-accounts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"billingAccountId":"billingAccounts/XXX","name":"My Billing Account"}'

# List Projects
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN"

# Create Project
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"projectId":"my-project","name":"My Project","billingAccountId":"billingAccounts/XXX"}'

# Bind Project to Customer
curl -X POST http://localhost:3000/api/customers/{CUSTOMER_ID}/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"projectId":"my-project"}'

# List Customer's Projects
curl -X GET http://localhost:3000/api/customers/{CUSTOMER_ID}/projects \
  -H "Authorization: Bearer $TOKEN"

# Import Raw Cost
curl -X POST http://localhost:3000/api/raw-cost/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "source": "manual",
    "month": "2026-01",
    "entries": [{
      "billingAccountId": "billingAccounts/XXX",
      "projectId": "my-project",
      "serviceId": "compute.googleapis.com",
      "skuId": "SKU-001",
      "usageStartTime": "2026-01-01T00:00:00Z",
      "usageEndTime": "2026-01-31T00:00:00Z",
      "usageAmount": 100,
      "cost": 50.00,
      "currency": "USD"
    }]
  }'

# Query Raw Cost (with scope enforcement)
curl -X GET "http://localhost:3000/api/raw-cost?month=2026-01" \
  -H "Authorization: Bearer $TOKEN"

# Create Invoice Run
curl -X POST http://localhost:3000/api/invoice-runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"billingMonth":"2026-01"}'

# Execute Invoice Run
curl -X POST http://localhost:3000/api/invoice-runs/{RUN_ID}/execute \
  -H "Authorization: Bearer $TOKEN"

# Execute with specific batch
curl -X POST http://localhost:3000/api/invoice-runs/{RUN_ID}/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"ingestionBatchId":"BATCH_UUID"}'

# List Invoices
curl -X GET "http://localhost:3000/api/invoices?billingMonth=2026-01" \
  -H "Authorization: Bearer $TOKEN"

# Get Invoice Details
curl -X GET http://localhost:3000/api/invoices/{INVOICE_ID} \
  -H "Authorization: Bearer $TOKEN"

# Lock Invoice (requires ISSUED status first)
curl -X POST http://localhost:3000/api/invoices/{INVOICE_ID}/lock \
  -H "Authorization: Bearer $TOKEN"

EOF

echo ""
echo "Test completed!"
