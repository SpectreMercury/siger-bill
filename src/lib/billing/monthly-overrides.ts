import * as XLSX from 'xlsx';
import {
  BillingProvider,
  BillingSourceType,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '@/lib/db';
import {
  TEMPLATE_HEADERS,
  type BillingTemplateBuildResult,
  type BillingTemplateCell,
  type BillingTemplateRow,
} from './monthly-template';

type RowRecord = Record<string, unknown>;

export type ParsedBillingOverrideLine = {
  rowNumber: number;
  customerId: string | null;
  companyName: string | null;
  billingAccountId: string;
  billingAccountName: string | null;
  projectName: string | null;
  projectId: string | null;
  serviceDescription: string | null;
  serviceId: string;
  skuDescription: string | null;
  skuId: string;
  usageStartTime: Date;
  usageEndTime: Date;
  usageAmount: Prisma.Decimal;
  usageUnit: string;
  currency: string;
  listCost: Prisma.Decimal | null;
  resellerCost: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  costAfterCredit: Prisma.Decimal | null;
  discountPrice: string | null;
  finalAmount: Prisma.Decimal | null;
  cnyAmount: Prisma.Decimal | null;
  transactionType: string | null;
  currencyConversionRate: Prisma.Decimal | null;
  rowData: Record<string, string | number | null>;
};

export type BillingOverrideSummary = {
  id: string;
  billingMonth: string;
  customerId: string | null;
  billingIngestionBatchId: string;
  sourceFilename: string;
  sourceFileHash: string;
  rowCount: number;
  isActive: boolean;
  uploadedAt: Date;
};

function normalizeCell(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const text = String(value).trim();
  return text === '' ? null : text;
}

function stringCell(record: RowRecord, header: string, required = false): string | null {
  const normalized = normalizeCell(record[header]);
  if (normalized == null) {
    if (required) throw new Error(`Missing required field: ${header}`);
    return null;
  }
  const text = String(normalized).trim();
  if (!text && required) throw new Error(`Missing required field: ${header}`);
  return text || null;
}

function decimalCell(record: RowRecord, header: string, required = false): Prisma.Decimal | null {
  const normalized = normalizeCell(record[header]);
  if (normalized == null) {
    if (required) throw new Error(`Missing required field: ${header}`);
    return null;
  }
  try {
    return new Prisma.Decimal(normalized);
  } catch {
    throw new Error(`Invalid numeric field ${header}: ${normalized}`);
  }
}

function dateCell(record: RowRecord, header: string): Date {
  const value = record[header];
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)));
    }
  }

  const text = stringCell(record, header, true);
  if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  const parsed = new Date(text ?? '');
  if (!Number.isNaN(parsed.getTime())) return parsed;
  throw new Error(`Invalid date field ${header}: ${text}`);
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatDecimal(value: Prisma.Decimal | null): string | null {
  if (value == null) return null;
  const fixed = value.toDecimalPlaces(10).toFixed(10);
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function headerRow(): BillingTemplateRow {
  return [...TEMPLATE_HEADERS];
}

function buildHeaderIndex(headers: unknown[]): Map<string, number> {
  const headerIndex = new Map<string, number>();
  headers.forEach((value, index) => {
    const text = normalizeCell(value);
    if (text != null) headerIndex.set(String(text).trim(), index);
  });
  for (const header of TEMPLATE_HEADERS) {
    if (!headerIndex.has(header)) {
      throw new Error(`Missing required header: ${header}`);
    }
  }
  return headerIndex;
}

function rowToRecord(row: unknown[], headerIndex: Map<string, number>): RowRecord {
  const record: RowRecord = {};
  for (const header of TEMPLATE_HEADERS) {
    record[header] = row[headerIndex.get(header)!];
  }
  return record;
}

async function loadCustomerResolver(forcedCustomerId?: string) {
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, externalId: true },
  });
  const bindings = await prisma.customerProject.findMany({
    where: { isActive: true },
    select: { projectId: true, customerId: true },
    orderBy: { createdAt: 'desc' },
  });

  const byProjectId = new Map(bindings.map((binding) => [binding.projectId, binding.customerId]));
  const byName = new Map<string, string>();
  for (const customer of customers) {
    byName.set(customer.name.trim().toLowerCase(), customer.id);
    if (customer.externalId) byName.set(customer.externalId.trim().toLowerCase(), customer.id);
  }

  return (projectId: string | null, companyName: string | null): string | null => {
    if (forcedCustomerId) return forcedCustomerId;
    if (projectId && byProjectId.has(projectId)) return byProjectId.get(projectId)!;
    if (companyName) return byName.get(companyName.trim().toLowerCase()) ?? null;
    return null;
  };
}

export async function parseBillingOverrideWorkbook(
  buffer: Buffer,
  options: { customerId?: string }
): Promise<ParsedBillingOverrideLine[]> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('Workbook has no sheets');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
    header: 1,
    raw: true,
    defval: null,
  });

  if (rows.length < 2) throw new Error('Workbook has no data rows');
  const headerIndex = buildHeaderIndex(rows[0]);
  const resolveCustomerId = await loadCustomerResolver(options.customerId);
  const parsed: ParsedBillingOverrideLine[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row || row.every((value) => normalizeCell(value) == null)) continue;
    const record = rowToRecord(row, headerIndex);

    const companyName = stringCell(record, '公司名称');
    const projectId = stringCell(record, '项目ID');
    const customerId = resolveCustomerId(projectId, companyName);
    const usageAmount = decimalCell(record, '使用量', true)!;
    const resellerCost = decimalCell(record, '经销商价', true)!;
    const creditAmount = decimalCell(record, '代金券减免') ?? new Prisma.Decimal(0);
    const costAfterCredit = decimalCell(record, '代金券减免后金额');

    const rowData = Object.fromEntries(
      TEMPLATE_HEADERS.map((header) => [header, normalizeCell(record[header])])
    ) as Record<string, string | number | null>;

    parsed.push({
      rowNumber: rowIndex + 1,
      customerId,
      companyName,
      billingAccountId: stringCell(record, '账单账号ID', true)!,
      billingAccountName: stringCell(record, '账单名称'),
      projectName: stringCell(record, '项目名称'),
      projectId,
      serviceDescription: stringCell(record, '服务描述'),
      serviceId: stringCell(record, '服务ID', true)!,
      skuDescription: stringCell(record, 'SKU描述'),
      skuId: stringCell(record, 'SKUid', true)!,
      usageStartTime: dateCell(record, '使用开始时间'),
      usageEndTime: dateCell(record, '使用结束时间'),
      usageAmount,
      usageUnit: stringCell(record, '用量单位', true)!,
      currency: stringCell(record, '费用单位') ?? 'USD',
      listCost: decimalCell(record, '列表价'),
      resellerCost,
      creditAmount,
      costAfterCredit,
      discountPrice: stringCell(record, 'Discount/Price'),
      finalAmount: decimalCell(record, '最终付款金额'),
      cnyAmount: decimalCell(record, '折后总金额(CNY,不含税)'),
      transactionType: stringCell(record, 'transaction_type'),
      currencyConversionRate: decimalCell(record, '汇率'),
      rowData,
    });
  }

  if (parsed.length === 0) throw new Error('Workbook has no usable data rows');
  return parsed;
}

export async function findActiveBillingMonthlyOverride(
  billingMonth: string,
  customerId?: string
): Promise<BillingOverrideSummary | null> {
  const scoped = customerId
    ? await prisma.billingMonthlyOverride.findFirst({
        where: { billingMonth, customerId, isActive: true },
        orderBy: { uploadedAt: 'desc' },
      })
    : null;
  const override = scoped ?? await prisma.billingMonthlyOverride.findFirst({
    where: { billingMonth, customerId: null, isActive: true },
    orderBy: { uploadedAt: 'desc' },
  });
  if (!override) return null;
  return {
    id: override.id,
    billingMonth: override.billingMonth,
    customerId: override.customerId,
    billingIngestionBatchId: override.billingIngestionBatchId,
    sourceFilename: override.sourceFilename,
    sourceFileHash: override.sourceFileHash,
    rowCount: override.rowCount,
    isActive: override.isActive,
    uploadedAt: override.uploadedAt,
  };
}

function overrideLineToTemplateRow(line: {
  companyName: string | null;
  billingAccountId: string;
  billingAccountName: string | null;
  projectName: string | null;
  projectId: string | null;
  serviceDescription: string | null;
  serviceId: string;
  skuDescription: string | null;
  skuId: string;
  usageStartTime: Date;
  usageEndTime: Date;
  usageAmount: Prisma.Decimal;
  usageUnit: string;
  currency: string;
  listCost: Prisma.Decimal | null;
  resellerCost: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  costAfterCredit: Prisma.Decimal | null;
  discountPrice: string | null;
  finalAmount: Prisma.Decimal | null;
  cnyAmount: Prisma.Decimal | null;
  transactionType: string | null;
  currencyConversionRate: Prisma.Decimal | null;
}): BillingTemplateRow {
  return [
    line.companyName,
    line.billingAccountId,
    line.billingAccountName,
    line.projectName,
    line.projectId,
    line.serviceDescription,
    line.serviceId,
    line.skuDescription,
    line.skuId,
    formatDate(line.usageStartTime),
    formatDate(line.usageEndTime),
    formatDecimal(line.usageAmount) as BillingTemplateCell,
    line.usageUnit,
    line.currency,
    formatDecimal(line.listCost),
    formatDecimal(line.resellerCost),
    formatDecimal(line.creditAmount),
    formatDecimal(line.costAfterCredit),
    line.discountPrice,
    formatDecimal(line.finalAmount),
    formatDecimal(line.cnyAmount),
    line.transactionType,
    formatDecimal(line.currencyConversionRate),
  ];
}

export async function buildOverrideTemplateRowsForMonth(options: {
  billingMonth: string;
  customerId?: string;
  page?: number;
  limit?: number;
}): Promise<BillingTemplateBuildResult | null> {
  const active = await findActiveBillingMonthlyOverride(options.billingMonth, options.customerId);
  if (!active) return null;

  const page = Math.max(options.page ?? 1, 1);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 5000);
  const where: Prisma.BillingMonthlyOverrideLineWhereInput = {
    overrideId: active.id,
    ...(options.customerId ? { customerId: options.customerId } : {}),
  };

  const lines = await prisma.billingMonthlyOverrideLine.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { rowNumber: 'asc' },
  });
  const total = await prisma.billingMonthlyOverrideLine.count({ where });

  return {
    rows: [headerRow(), ...lines.map(overrideLineToTemplateRow)],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    activeOverride: {
      id: active.id,
      sourceFilename: active.sourceFilename,
      uploadedAt: active.uploadedAt,
      rowCount: active.rowCount,
    },
  };
}

export async function createBillingMonthlyOverride(params: {
  billingMonth: string;
  customerId?: string;
  sourceFilename: string;
  fileBuffer: Buffer;
  uploadedBy: string;
}): Promise<BillingOverrideSummary> {
  const sourceFileHash = createHash('sha256').update(params.fileBuffer).digest('hex');
  const lines = await parseBillingOverrideWorkbook(params.fileBuffer, { customerId: params.customerId });

  const created = await prisma.$transaction(async (tx) => {
    await tx.billingMonthlyOverride.updateMany({
      where: {
        billingMonth: params.billingMonth,
        customerId: params.customerId ?? null,
        isActive: true,
      },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
      },
    });

    const batch = await tx.billingIngestionBatch.create({
      data: {
        provider: BillingProvider.GCP,
        sourceType: BillingSourceType.MANUAL_IMPORT,
        invoiceMonth: params.billingMonth,
        rowCount: lines.length,
        checksum: sourceFileHash,
        sourceMetadata: {
          source: 'monthly_billing_override',
          sourceFilename: params.sourceFilename,
          customerId: params.customerId ?? null,
        } as Prisma.InputJsonValue,
        createdBy: params.uploadedBy,
      },
    });

    const override = await tx.billingMonthlyOverride.create({
      data: {
        billingMonth: params.billingMonth,
        customerId: params.customerId ?? null,
        billingIngestionBatchId: batch.id,
        sourceFilename: params.sourceFilename,
        sourceFileHash,
        rowCount: lines.length,
        isActive: true,
        uploadedBy: params.uploadedBy,
      },
    });

    await tx.billingMonthlyOverrideLine.createMany({
      data: lines.map((line) => ({
        overrideId: override.id,
        rowNumber: line.rowNumber,
        customerId: line.customerId,
        companyName: line.companyName,
        billingAccountId: line.billingAccountId,
        billingAccountName: line.billingAccountName,
        projectName: line.projectName,
        projectId: line.projectId,
        serviceDescription: line.serviceDescription,
        serviceId: line.serviceId,
        skuDescription: line.skuDescription,
        skuId: line.skuId,
        usageStartTime: line.usageStartTime,
        usageEndTime: line.usageEndTime,
        usageAmount: line.usageAmount,
        usageUnit: line.usageUnit,
        currency: line.currency,
        listCost: line.listCost,
        resellerCost: line.resellerCost,
        creditAmount: line.creditAmount,
        costAfterCredit: line.costAfterCredit,
        discountPrice: line.discountPrice,
        finalAmount: line.finalAmount,
        cnyAmount: line.cnyAmount,
        transactionType: line.transactionType,
        currencyConversionRate: line.currencyConversionRate,
        rowData: line.rowData as Prisma.InputJsonValue,
      })),
    });

    await tx.billingLineItem.createMany({
      data: lines.map((line) => ({
        ingestionBatchId: batch.id,
        provider: BillingProvider.GCP,
        sourceType: BillingSourceType.MANUAL_IMPORT,
        accountId: line.billingAccountId,
        billingAccountName: line.billingAccountName,
        subaccountId: line.projectId,
        projectName: line.projectName,
        productId: line.serviceId,
        serviceDescription: line.serviceDescription,
        meterId: line.skuId,
        skuDescription: line.skuDescription,
        usageAmount: line.usageAmount,
        usageUnit: line.usageUnit,
        pricingUsageAmount: line.usageAmount,
        pricingUsageUnit: line.usageUnit,
        cost: line.resellerCost,
        listCost: line.listCost,
        creditAmount: line.creditAmount,
        costAfterCredit: line.costAfterCredit,
        currency: line.currency,
        currencyConversionRate: line.currencyConversionRate,
        creditBreakdown: line.rowData as Prisma.InputJsonValue,
        transactionType: line.transactionType,
        usageStartTime: line.usageStartTime,
        usageEndTime: line.usageEndTime,
        invoiceMonth: params.billingMonth,
        rawPayload: line.rowData as Prisma.InputJsonValue,
      })),
    });

    return { override, batchId: batch.id };
  });

  return {
    id: created.override.id,
    billingMonth: created.override.billingMonth,
    customerId: created.override.customerId,
    billingIngestionBatchId: created.batchId,
    sourceFilename: created.override.sourceFilename,
    sourceFileHash: created.override.sourceFileHash,
    rowCount: created.override.rowCount,
    isActive: created.override.isActive,
    uploadedAt: created.override.uploadedAt,
  };
}

export { TEMPLATE_HEADERS };
