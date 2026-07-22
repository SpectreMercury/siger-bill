import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

type BillingResponse = {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  pagination: { total: number };
};

const baseUrl = (process.env.SIEGER_BASE_URL ?? 'https://siger-bill.vercel.app').replace(/\/$/, '');
const email = process.env.SIEGER_ADMIN_EMAIL;
const password = process.env.SIEGER_ADMIN_PASSWORD;

assert.ok(email, 'SIEGER_ADMIN_EMAIL is required');
assert.ok(password, 'SIEGER_ADMIN_PASSWORD is required');

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.text();
  assert.ok(response.ok, `${init?.method ?? 'GET'} ${path} failed (${response.status}): ${body}`);
  return JSON.parse(body) as T;
}

async function requestBuffer(path: string, init?: RequestInit): Promise<Buffer> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(response.ok, `${init?.method ?? 'GET'} ${path} failed (${response.status})`);
  return body;
}

function assertBillingRows(params: {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  expectedRows: number;
  expectedList: number;
  expectedVoucher: number;
  expectedFinal: number;
  expectedTemplate: 'STANDARD' | 'COST';
}) {
  assert.equal(params.rows.length, params.expectedRows);

  const column = (header: string) => {
    const index = params.headers.indexOf(header);
    assert.notEqual(index, -1, `missing column: ${header}`);
    return index;
  };
  if (params.expectedTemplate === 'STANDARD') {
    assert.ok(params.headers.includes('资源名称'));
    assert.ok(params.headers.includes('合同优惠金额'));
    assert.ok(params.headers.includes('优惠后金额'));
    assert.ok(!params.headers.includes('经销商价'), 'STANDARD template must not expose reseller cost');
  } else {
    assert.ok(params.headers.includes('经销商价'));
    assert.ok(!params.headers.includes('合同优惠金额'));
  }

  const uniqueKeys = new Set(params.rows.map((row) => JSON.stringify([
    row[column('账单账号ID')],
    row[column('项目ID')],
    row[column('服务ID')],
    row[column('SKUid')],
  ])));
  assert.equal(uniqueKeys.size, params.expectedRows, 'rows must be merged by billing/project/service/SKU');

  const total = (index: number) => params.rows.reduce(
    (sum, row) => sum + Number(row[index] ?? 0),
    0
  );
  assert.ok(Math.abs(total(column('列表价')) - params.expectedList) < 1e-6, 'unexpected list total');
  assert.ok(Math.abs(total(column('代金券减免')) - params.expectedVoucher) < 1e-6, 'unexpected configured credit total');
  assert.ok(Math.abs(total(column('最终付款金额')) - params.expectedFinal) < 1e-6, 'unexpected final total');

  const numericHeaders = params.expectedTemplate === 'STANDARD'
    ? ['使用量', '列表价', '合同优惠金额', '优惠后金额', '代金券减免', '最终付款金额', '折后总金额(CNY,不含税)']
    : ['使用量', '列表价', '经销商价', '代金券减免', '代金券减免后金额', '最终付款金额', '折后总金额(CNY,不含税)', '汇率'];
  for (const header of numericHeaders) {
    const index = column(header);
    for (const row of params.rows) {
      if (row[index] != null) assert.equal(typeof row[index], 'number', `${header} must be numeric`);
    }
  }

  for (const row of params.rows) {
    assert.ok(
      String(row[column('使用开始时间')]) <= String(row[column('使用结束时间')]),
      'merged start date must not exceed end date'
    );
  }
}

async function loadCustomerRows(params: {
  token: string;
  customerId: string;
  expectedRows: number;
  expectedList: number;
  expectedVoucher: number;
  expectedFinal: number;
  expectedTemplate: 'STANDARD' | 'COST';
}) {
  const query = new URLSearchParams({
    billingMonth: '2026-06',
    customerId: params.customerId,
    page: '1',
    limit: '5000',
  });
  const result = await requestJson<BillingResponse>(`/api/billing/monthly-lines?${query}`, {
    headers: { Authorization: `Bearer ${params.token}` },
  });

  assert.equal(result.pagination.total, params.expectedRows);
  assertBillingRows({ ...params, headers: result.headers, rows: result.rows });

  const exportBuffer = await requestBuffer(`/api/billing/monthly-lines/export?${query}`, {
    headers: { Authorization: `Bearer ${params.token}` },
  });
  if (process.env.EXPORT_OUTPUT_DIR) {
    await mkdir(process.env.EXPORT_OUTPUT_DIR, { recursive: true });
    await writeFile(
      path.join(process.env.EXPORT_OUTPUT_DIR, `${params.customerId}.xlsx`),
      exportBuffer
    );
  }
  const workbook = XLSX.read(exportBuffer, { type: 'buffer', cellNF: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const exportedData = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const exportedHeaders = exportedData[0].map(String);
  const exportedRows = exportedData.slice(1);
  assertBillingRows({ ...params, headers: exportedHeaders, rows: exportedRows });

  const numericHeaders = params.expectedTemplate === 'STANDARD'
    ? ['使用量', '列表价', '合同优惠金额', '优惠后金额', '代金券减免', '最终付款金额', '折后总金额(CNY,不含税)']
    : ['使用量', '列表价', '经销商价', '代金券减免', '代金券减免后金额', '最终付款金额', '折后总金额(CNY,不含税)', '汇率'];
  for (const header of numericHeaders) {
    const column = exportedHeaders.indexOf(header);
    assert.notEqual(column, -1, `missing exported numeric column: ${header}`);
    for (let row = 1; row < exportedData.length; row += 1) {
      if (exportedData[row][column] == null) continue;
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      assert.equal(cell?.t, 'n', `${header} must be stored as an Excel numeric cell`);
      assert.equal(cell?.z, 'General', `${header} must use Excel General format`);
    }
  }
}

async function main() {
  const login = await requestJson<{ token: string }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  await loadCustomerRows({
    token: login.token,
    customerId: process.env.SW_CUSTOMER_ID ?? 'd6476613-dc8e-4fe9-af07-a7fcd81c8fd2',
    expectedRows: 119,
    expectedList: 422.808012,
    expectedVoucher: -94.078696,
    expectedFinal: 328.729316,
    expectedTemplate: 'STANDARD',
  });
  await loadCustomerRows({
    token: login.token,
    customerId: process.env.BT_CUSTOMER_ID ?? '041ae585-3717-4674-b7b3-a2e677e6db02',
    // Five is correct because Billing Account is part of the requested key.
    expectedRows: 5,
    expectedList: 9592.54122,
    expectedVoucher: 0,
    expectedFinal: 8633.287098,
    expectedTemplate: 'STANDARD',
  });

  if (process.env.SKIP_GCP_CONNECTION_CHECK !== '1') {
    const connectionId = process.env.GCP_CONNECTION_ID ?? '7ccf3cef-6451-42b9-835a-6394a3c73b8e';
    const bigQuery = await requestJson<{ ok: boolean; source?: string }>(
      `/api/admin/gcp-connections/${connectionId}/test-bigquery`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${login.token}` },
      }
    );
    assert.equal(bigQuery.ok, true);
    assert.equal(bigQuery.source, 'sieger-billing-project.sieger_billing_share.test_billing_2');
  }

  console.log('live monthly billing integration tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
