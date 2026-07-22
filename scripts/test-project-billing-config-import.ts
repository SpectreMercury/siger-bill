import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS,
  generateProjectBillingConfigTemplate,
  parseProjectBillingConfigWorkbook,
} from '../src/lib/project-billing-configs/workbook';
import { chooseCustomerProjectBindingActivation } from '../src/lib/project-billing-configs/bindings';

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Project计费配置');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const parsed = parseProjectBillingConfigWorkbook(workbookBuffer([
  [...PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS],
  ['project-one', '生产项目', 'Acme', 'cud', 'BILL-001'],
  ['project-two', null, null, 'Startup', null],
]));

assert.deepEqual(parsed, [
  {
    rowNumber: 2,
    projectId: 'project-one',
    name: '生产项目',
    customerName: 'Acme',
    chargeType: 'CUD',
    billingAccountId: 'BILL-001',
  },
  {
    rowNumber: 3,
    projectId: 'project-two',
    name: null,
    customerName: null,
    chargeType: 'STARTUP',
    billingAccountId: null,
  },
]);

const template = XLSX.read(generateProjectBillingConfigTemplate(), { type: 'buffer' });
const templateRows = XLSX.utils.sheet_to_json<unknown[]>(template.Sheets[template.SheetNames[0]], {
  header: 1,
  raw: true,
});
assert.deepEqual(templateRows[0], [...PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS]);

assert.equal(chooseCustomerProjectBindingActivation('active', 'same-day'), 'KEEP');
assert.equal(chooseCustomerProjectBindingActivation(null, 'same-day'), 'REACTIVATE');
assert.equal(chooseCustomerProjectBindingActivation(null, null), 'CREATE');

assert.throws(
  () => parseProjectBillingConfigWorkbook(workbookBuffer([
    [...PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS],
    ['duplicate-project', '', '', 'BILLABLE', ''],
    ['duplicate-project', '', '', 'POC', ''],
  ])),
  /第 3 行.*duplicate-project.*重复/
);

assert.throws(
  () => parseProjectBillingConfigWorkbook(workbookBuffer([
    [...PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS],
    ['invalid-project', '', '', 'UNKNOWN', ''],
  ])),
  /第 2 行.*收费类型/
);

console.log('project billing config workbook tests passed');
