/**
 * Dashboard API response types
 */

export interface DashboardFilters {
  from: string;
  to: string;
  provider?: string;
  customerId?: string;
}

export interface DashboardOverviewResponse {
  currentMonth: string;
  totalListAmount: string;
  totalDiscountAmount: string;
  totalTierDiscountAmount: string;
  totalCreditAmount: string;
  totalFinalAmount: string;
  totalGrossMargin?: string;
  totalNetMargin?: string;
  marginPercent?: string;
  customerCount: number;
  invoiceCount: number;
  momGrowth: string | null;
}

export interface TrendDataPoint {
  month: string;
  listAmount: string;
  discountAmount: string;
  tierDiscountAmount: string;
  creditAmount: string;
  finalAmount: string;
  grossMargin?: string;
  customerCount: number;
  invoiceCount: number;
}

export interface TrendsResponse {
  data: TrendDataPoint[];
}

export interface ProviderMixItem {
  provider: string;
  amount: string;
  percentage: string;
}

export interface ProviderMixResponse {
  data: ProviderMixItem[];
}

export interface ProductItem {
  productGroup: string;
  skuGroupCode?: string;
  amount: string;
  percentage: string;
}

export interface ProductsResponse {
  data: ProductItem[];
}

export interface CustomerRankingItem {
  customerId: string;
  customerName: string;
  externalId: string | null;
  totalRevenue: string;
  momGrowth: string | null;
  invoiceCount: number;
  rank: number;
}

export interface CustomersResponse {
  data: CustomerRankingItem[];
}

export interface MonthsResponse {
  data: string[];
}
