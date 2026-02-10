/**
 * Invoice API response types
 */

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED' | 'LOCKED';

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerExternalId?: string;
  billingMonth: string;
  status: InvoiceStatus;
  subtotal: string;
  taxAmount: string;
  creditAmount: string;
  totalAmount: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export interface InvoiceListResponse {
  data: InvoiceListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface InvoiceLineItem {
  id: string;
  lineNumber: number;
  description: string;
  productGroup?: string;
  skuGroupCode?: string;
  provider?: string;
  service?: string;
  quantity: string;
  unitPrice: string;
  listAmount: string;
  discountAmount: string;
  tierDiscountAmount: string;
  creditAmount: string;
  amount: string;
  metadata?: Record<string, unknown>;
}

export interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer: {
    id: string;
    name: string;
    externalId: string | null;
    currency: string;
  };
  billingMonth: string;
  status: InvoiceStatus;
  subtotal: string;
  listAmount: string;
  discountAmount: string;
  tierDiscountAmount: string;
  creditAmount: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  lineItems: InvoiceLineItem[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceFilters {
  from?: string;
  to?: string;
  status?: InvoiceStatus | '';
  locked?: 'all' | 'locked' | 'unlocked';
  customerId?: string;
}

export type ExportFormat = 'pdf' | 'xlsx' | 'csv';
