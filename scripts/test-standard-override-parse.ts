import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBillingOverrideWorkbook } from '../src/lib/billing/monthly-overrides';

async function main() {
  const workbookPath = process.env.STANDARD_OVERRIDE_XLSX;
  assert.ok(workbookPath, 'STANDARD_OVERRIDE_XLSX is required');
  const lines = await parseBillingOverrideWorkbook(await readFile(workbookPath), {
    customerId: process.env.STANDARD_OVERRIDE_CUSTOMER_ID,
  });
  assert.equal(lines.length, 119);

  const first = lines[0];
  assert.equal(first.listCost?.toString(), '3.532079');
  assert.equal(first.resellerCost.toString(), '3.532079');
  assert.equal(first.creditAmount.toString(), '-0.77394');
  assert.equal(first.costAfterCredit?.toString(), '2.758139');
  assert.equal(first.finalAmount?.toString(), '2.758139');
  assert.equal(first.currencyConversionRate?.toString(), '1');
  assert.ok('合同优惠金额' in first.rowData);
  assert.ok(!('经销商价' in first.rowData));

  console.log('standard override parse test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
