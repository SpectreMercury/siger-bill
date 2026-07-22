export const STANDARD_TEMPLATE_HEADERS = [
  '公司名称',
  '账单账号ID',
  '标签',
  '项目名称',
  '项目ID',
  '服务描述',
  '服务ID',
  'SKU描述',
  'SKUid',
  '资源名称',
  '资源唯一标识符',
  '使用开始时间',
  '使用结束时间',
  '使用量',
  '用量单位',
  '费用单位',
  '列表价',
  'Discount/Price',
  '合同优惠金额',
  '优惠后金额',
  '代金券减免',
  '最终付款金额',
  '折后总金额(CNY,不含税)',
  'transaction_type',
  '收费类型',
] as const;

export const COST_TEMPLATE_HEADERS = [
  '公司名称',
  '账单账号ID',
  '账单名称',
  '项目名称',
  '项目ID',
  '服务描述',
  '服务ID',
  'SKU描述',
  'SKUid',
  '使用开始时间',
  '使用结束时间',
  '使用量',
  '用量单位',
  '费用单位',
  '列表价',
  '经销商价',
  '代金券减免',
  '代金券减免后金额',
  'Discount/Price',
  '最终付款金额',
  '折后总金额(CNY,不含税)',
  'transaction_type',
  '汇率',
] as const;

// Backward-compatible alias for COST override imports.
export const TEMPLATE_HEADERS = COST_TEMPLATE_HEADERS;

export type BillingTemplateHeaders = readonly string[];
export type MonthlyTemplateBasis = 'STANDARD' | 'COST';

export function resolveMonthlyTemplateHeaders(
  priceBasis: MonthlyTemplateBasis
): BillingTemplateHeaders {
  return priceBasis === 'STANDARD' ? STANDARD_TEMPLATE_HEADERS : COST_TEMPLATE_HEADERS;
}

export type BillingTemplateCell = string | number | Date | null;
export type BillingTemplateRow = BillingTemplateCell[];

export type BillingTemplateBuildResult = {
  headers: BillingTemplateHeaders;
  rows: BillingTemplateRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  activeOverride?: {
    id: string;
    sourceFilename: string;
    uploadedAt: Date;
    rowCount: number;
  } | null;
};
