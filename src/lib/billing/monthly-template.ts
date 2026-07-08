export const TEMPLATE_HEADERS = [
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

export type BillingTemplateCell = string | number | Date | null;
export type BillingTemplateRow = BillingTemplateCell[];

export type BillingTemplateBuildResult = {
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
