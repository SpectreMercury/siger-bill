/**
 * Client-side type definitions
 */

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  scopes: Array<{
    scopeType: 'CUSTOMER' | 'PROJECT';
    scopeId: string;
  }>;
  isSuperAdmin: boolean;
}

export interface Customer {
  id: string;
  name: string;
  externalId: string | null;
  currency: string;
  paymentTermsDays: number;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  gcpConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer?: Customer;
  billingMonth: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED' | 'LOCKED';
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

export interface InvoiceRun {
  id: string;
  billingMonth: string;
  provider: string | null;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  totalInvoices: number;
  totalAmount: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  projectId: string;
  projectNumber: string | null;
  name: string | null;
  iamRole: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'NOT_FOUND' | 'NO_BILLING';
  billingAccount: {
    billingAccountId: string;
    name: string | null;
  } | null;
  boundCustomers: Array<{
    customerId: string;
    customerName: string;
    startDate: string | null;
    endDate: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface BillingAccount {
  id: string;
  billingAccountId: string;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'UNKNOWN';
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkuGroup {
  id: string;
  code: string;
  name: string;
  description: string | null;
  skuCount: number;
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PricingList {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  isActive: boolean;
  customer: {
    id: string;
    name: string;
    externalId: string | null;
  };
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Credit {
  id: string;
  customerId: string;
  type: string;
  totalAmount: string;
  remainingAmount: string;
  description: string | null;
  validFrom: string;
  validTo: string;
  isActive: boolean;
}

export interface SpecialRule {
  id: string;
  customerId: string;
  name: string;
  ruleType: string;
  config: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  isActive: boolean;
}

export interface DashboardOverview {
  currentMonth: string;
  totalRevenue: string;
  totalCustomers: number;
  totalInvoices: number;
  avgRevenuePerCustomer: string;
  momGrowth: string;
  topProducts: Array<{ productGroup: string; amount: string; percentage: string }>;
  providerMix: Array<{ provider: string; amount: string; percentage: string }>;
}

export interface TrendDataPoint {
  month: string;
  totalRevenue: string;
  totalDiscount: string;
  totalCredits: string;
  customerCount: number;
  invoiceCount: number;
}

export interface CustomerRanking {
  customerId: string;
  customerName: string;
  externalId: string | null;
  totalRevenue: string;
  momGrowth: string | null;
  invoiceCount: number;
  rank: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
