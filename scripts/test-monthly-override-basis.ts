import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  COST_TEMPLATE_HEADERS,
  STANDARD_TEMPLATE_HEADERS,
  type BillingTemplateHeaders,
} from '../src/lib/billing/monthly-template';
import {
  detectBillingOverrideWorkbookBasis,
  parseBillingOverrideWorkbook,
  restoreBillingOverrideRow,
} from '../src/lib/billing/monthly-overrides';

function workbookFor(headers: BillingTemplateHeaders): Buffer {
  const values: Record<string, string | number> = {
    '公司名称': 'Acme',
    '账单账号ID': 'BILL-1',
    '账单名称': 'Billing One',
    '标签': 'Billing One',
    '项目ID': 'project-one',
    '服务ID': 'service-one',
    'SKUid': 'sku-one',
    '使用开始时间': '2026-06-01',
    '使用结束时间': '2026-06-02',
    '使用量': 1,
    '用量单位': 'count',
    '费用单位': 'USD',
    '列表价': 12,
    '经销商价': 10,
    '优惠后金额': 10,
    '代金券减免': -2,
    '代金券减免后金额': 8,
    '最终付款金额': 8,
    '折后总金额(CNY,不含税)': 56,
    '汇率': 7,
    '资源名称': 'instance-one',
    '资源唯一标识符': 'resource-one',
    '收费类型': 'CUD',
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...headers],
      headers.map((header) => values[header] ?? ''),
    ]),
    '账单'
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function main() {
  assert.equal(
    detectBillingOverrideWorkbookBasis(workbookFor(STANDARD_TEMPLATE_HEADERS)),
    'STANDARD'
  );
  assert.equal(
    detectBillingOverrideWorkbookBasis(workbookFor(COST_TEMPLATE_HEADERS)),
    'COST'
  );

  const standard = await parseBillingOverrideWorkbook(workbookFor(STANDARD_TEMPLATE_HEADERS), {
    customerId: 'customer-one',
    priceBasis: 'STANDARD',
  });
  assert.equal(standard.length, 1);
  const restoredStandardRow = restoreBillingOverrideRow(
    standard[0].rowData,
    STANDARD_TEMPLATE_HEADERS
  );
  assert.equal(restoredStandardRow[STANDARD_TEMPLATE_HEADERS.indexOf('资源名称')], 'instance-one');
  assert.equal(
    restoredStandardRow[STANDARD_TEMPLATE_HEADERS.indexOf('资源唯一标识符')],
    'resource-one'
  );
  assert.equal(restoredStandardRow[STANDARD_TEMPLATE_HEADERS.indexOf('收费类型')], 'CUD');

  const cost = await parseBillingOverrideWorkbook(workbookFor(COST_TEMPLATE_HEADERS), {
    customerId: 'customer-one',
    priceBasis: 'COST',
  });
  assert.equal(cost.length, 1);

  await assert.rejects(
    parseBillingOverrideWorkbook(workbookFor(COST_TEMPLATE_HEADERS), {
      customerId: 'customer-one',
      priceBasis: 'STANDARD',
    }),
    /选择的是列表价模板.*上传文件是 Cost 模板/
  );
}

main()
  .then(() => console.log('monthly override basis tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
