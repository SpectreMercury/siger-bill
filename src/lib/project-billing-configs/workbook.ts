import * as XLSX from 'xlsx';
import { PROJECT_CHARGE_TYPES } from './charge-type';

export const PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS = [
  'Project ID',
  '名称',
  '客户名称',
  '收费类型',
  'Billing ID',
] as const;

export type ProjectChargeTypeValue = typeof PROJECT_CHARGE_TYPES[number];

export interface ProjectBillingConfigImportRow {
  rowNumber: number;
  projectId: string;
  name: string | null;
  customerName: string | null;
  chargeType: ProjectChargeTypeValue;
  billingAccountId: string | null;
}

function normalizedText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeChargeType(value: unknown, rowNumber: number): ProjectChargeTypeValue {
  const text = normalizedText(value)?.toUpperCase();
  const aliases: Record<string, ProjectChargeTypeValue> = {
    '是': 'BILLABLE',
    '收费': 'BILLABLE',
    '否': 'NON_BILLABLE',
    '不收费': 'NON_BILLABLE',
  };
  const normalized = text ? (aliases[text] ?? text) : 'BILLABLE';
  if (!PROJECT_CHARGE_TYPES.includes(normalized as ProjectChargeTypeValue)) {
    throw new Error(
      `第 ${rowNumber} 行收费类型无效：${normalizedText(value) ?? '空'}；` +
      `可选值为 ${PROJECT_CHARGE_TYPES.join(', ')}`
    );
  }
  return normalized as ProjectChargeTypeValue;
}

export function parseProjectBillingConfigWorkbook(
  buffer: Buffer
): ProjectBillingConfigImportRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('Excel 中没有工作表');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
    header: 1,
    raw: true,
    defval: null,
  });
  if (rows.length === 0) throw new Error('Excel 中没有表头');

  const headerIndex = new Map<string, number>();
  rows[0].forEach((cell, index) => {
    const header = normalizedText(cell);
    if (header) headerIndex.set(header, index);
  });
  for (const header of PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS) {
    if (!headerIndex.has(header)) throw new Error(`缺少必填表头：${header}`);
  }

  const cell = (row: unknown[], header: typeof PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS[number]) =>
    row[headerIndex.get(header)!];
  const seenProjectIds = new Map<string, number>();
  const parsed: ProjectBillingConfigImportRow[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((value) => normalizedText(value) === null)) continue;
    const rowNumber = index + 1;
    const projectId = normalizedText(cell(row, 'Project ID'));
    if (!projectId) throw new Error(`第 ${rowNumber} 行 Project ID 不能为空`);

    const previousRow = seenProjectIds.get(projectId);
    if (previousRow) {
      throw new Error(
        `第 ${rowNumber} 行 Project ID "${projectId}" 重复（首次出现在第 ${previousRow} 行）`
      );
    }
    seenProjectIds.set(projectId, rowNumber);

    parsed.push({
      rowNumber,
      projectId,
      name: normalizedText(cell(row, '名称')),
      customerName: normalizedText(cell(row, '客户名称')),
      chargeType: normalizeChargeType(cell(row, '收费类型'), rowNumber),
      billingAccountId: normalizedText(cell(row, 'Billing ID')),
    });
  }

  if (parsed.length === 0) throw new Error('Excel 中没有可导入的数据行');
  return parsed;
}

export function generateProjectBillingConfigTemplate(): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...PROJECT_BILLING_CONFIG_TEMPLATE_HEADERS],
  ]);
  worksheet['!cols'] = [
    { wch: 28 },
    { wch: 24 },
    { wch: 24 },
    { wch: 18 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Project计费配置');

  const instructions = XLSX.utils.aoa_to_sheet([
    ['字段', '是否必填', '示例/说明'],
    ['Project ID', '是', 'example-project-id'],
    ['名称', '否', '展示名称'],
    ['客户名称', '否', '客户名称或唯一 External ID；留空会解除现有客户关联'],
    ['收费类型', '否', 'BILLABLE / NON_BILLABLE / CUD / POC / STARTUP；留空默认为 BILLABLE'],
    ['Billing ID', '否', '必须是系统中已有的 Billing ID'],
  ]);
  instructions['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(workbook, instructions, '填写说明');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
